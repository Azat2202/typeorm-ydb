import type { CredentialsProvider } from "@ydbjs/auth"
import type { Driver as YdbSdkDriver } from "@ydbjs/core"
import type { QueryClient } from "@ydbjs/query"
import type { ObjectLiteral } from "../../common/ObjectLiteral"
import type { DataSource } from "../../data-source"
import { DriverPackageNotInstalledError } from "../../error/DriverPackageNotInstalledError"
import { TypeORMError } from "../../error/TypeORMError"
import type { ColumnMetadata } from "../../metadata/ColumnMetadata"
import { FindOperator } from "../../find-options/FindOperator"
import { EntityMetadata } from "../../metadata/EntityMetadata"
import { PlatformTools } from "../../platform/PlatformTools"
import { RdbmsSchemaBuilder } from "../../schema-builder/RdbmsSchemaBuilder"
import { Table } from "../../schema-builder/table/Table"
import type { TableColumn } from "../../schema-builder/table/TableColumn"
import { TableForeignKey } from "../../schema-builder/table/TableForeignKey"
import { View } from "../../schema-builder/view/View"
import { ApplyValueTransformers } from "../../util/ApplyValueTransformers"
import { DateUtils } from "../../util/DateUtils"
import type { Driver } from "../Driver"
import type { ColumnType } from "../types/ColumnTypes"
import type { CteCapabilities } from "../types/CteCapabilities"
import type { DataTypeDefaults } from "../types/DataTypeDefaults"
import type { IsolationLevel } from "../types/IsolationLevel"
import type { MappedColumnTypes } from "../types/MappedColumnTypes"
import type { OnDeleteType } from "../../metadata/types/OnDeleteType"
import type { ReplicationMode } from "../types/ReplicationMode"
import type { UpsertType } from "../types/UpsertType"
import type { YdbDataSourceOptions } from "./YdbDataSourceOptions"
import { YdbNotImplementedError } from "./YdbNotImplementedError"
import { isYdbValue, type YdbValueModules } from "./YdbParameters"
import { YdbQueryRunner } from "./YdbQueryRunner"

/**
 * Organizes communication with YDB.
 */
export class YdbDriver implements Driver {
    // -------------------------------------------------------------------------
    // Static Properties
    // -------------------------------------------------------------------------

    /**
     * Lower-cased type names mapped to YDB types: YDB names in any case and aliases used by other databases.
     * Note that "string" is a byte string in YDB, text is "Utf8".
     */
    static readonly typeAliases: Record<string, string> = {
        bool: "Bool",
        boolean: "Bool",
        int8: "Int8",
        tinyint: "Int8",
        int16: "Int16",
        smallint: "Int16",
        int2: "Int16",
        int32: "Int32",
        int: "Int32",
        integer: "Int32",
        int4: "Int32",
        int64: "Int64",
        bigint: "Int64",
        uint8: "Uint8",
        uint16: "Uint16",
        uint32: "Uint32",
        uint64: "Uint64",
        float: "Float",
        real: "Float",
        float4: "Float",
        double: "Double",
        "double precision": "Double",
        float8: "Double",
        decimal: "Decimal",
        numeric: "Decimal",
        utf8: "Utf8",
        text: "Utf8",
        varchar: "Utf8",
        "character varying": "Utf8",
        char: "Utf8",
        character: "Utf8",
        nvarchar: "Utf8",
        "simple-array": "Utf8",
        "simple-json": "Utf8",
        "simple-enum": "Utf8",
        enum: "Utf8",
        string: "String",
        bytes: "String",
        blob: "String",
        binary: "String",
        varbinary: "String",
        bytea: "String",
        json: "Json",
        jsondocument: "JsonDocument",
        jsonb: "JsonDocument",
        uuid: "Uuid",
        date: "Date",
        datetime: "Datetime",
        timestamp: "Timestamp",
        timestamptz: "Timestamp",
        interval: "Interval",
    }

    // -------------------------------------------------------------------------
    // Public Properties
    // -------------------------------------------------------------------------

    /**
     * DataSource used by the driver.
     */
    dataSource: DataSource

    /**
     * Isolation levels supported by this driver.
     */
    supportedIsolationLevels: IsolationLevel[] = []

    /**
     * DataSource used by the driver.
     *
     * @deprecated since 1.0.0. Use {@link dataSource} instance instead.
     */
    get connection(): DataSource {
        return this.dataSource
    }

    /**
     * `@ydbjs/core` module.
     */
    ydbCore: any

    /**
     * `@ydbjs/query` module.
     */
    ydbQuery: any

    /**
     * `@ydbjs/value` modules used to build query parameters.
     */
    ydbValueModules: YdbValueModules

    /**
     * `StatsMode` enum of `@ydbjs/api/query`.
     */
    ydbStatsMode: any

    /**
     * `@ydbjs/error` module.
     */
    ydbError: any

    /**
     * YDB SDK driver. Set while the data source is connected.
     */
    ydb?: YdbSdkDriver

    /**
     * Query client of the YDB SDK. Set while the data source is connected.
     */
    client?: QueryClient

    /**
     * Database path, e.g. "/local".
     */
    database?: string

    // -------------------------------------------------------------------------
    // Public Implemented Properties
    // -------------------------------------------------------------------------

    /**
     * DataSource options.
     */
    options: YdbDataSourceOptions

    /**
     * Indicates if replication is enabled.
     */
    isReplicated: boolean = false

    /**
     * Indicates if tree tables are supported by this driver.
     */
    treeSupport = false

    /**
     * Represent transaction support by this driver
     */
    transactionSupport = "none" as const

    /**
     * Gets list of supported column data types by a driver.
     *
     * Decimal, Interval and the wide date types (Date32, Datetime64, Timestamp64, Interval64)
     * are not supported yet: the YDB SDK cannot encode or decode them.
     *
     * @see https://ydb.tech/docs/en/yql/reference/types/primitive
     */
    supportedDataTypes: ColumnType[] = [
        "Bool",
        "Int8",
        "Int16",
        "Int32",
        "Int64",
        "Uint8",
        "Uint16",
        "Uint32",
        "Uint64",
        "Float",
        "Double",
        "Utf8",
        "String",
        "Json",
        "JsonDocument",
        "Uuid",
        "Date",
        "Datetime",
        "Timestamp",
    ]

    /**
     * Returns type of upsert supported by driver if any
     */
    supportedUpsertTypes: UpsertType[] = []

    /**
     * Foreign keys are not supported by YDB.
     */
    supportedOnDeleteTypes: OnDeleteType[] = []

    /**
     * Gets list of spatial column data types.
     */
    spatialTypes: ColumnType[] = []

    /**
     * Gets list of column data types that support length by a driver.
     * YDB strings have no length: it is accepted for portability and ignored.
     */
    withLengthColumnTypes: ColumnType[] = ["Utf8", "String"]

    /**
     * Gets list of column data types that support precision by a driver.
     */
    withPrecisionColumnTypes: ColumnType[] = []

    /**
     * Gets list of column data types that supports scale by a driver.
     */
    withScaleColumnTypes: ColumnType[] = []

    /**
     * ORM has special columns and we need to know what database column types should be for those columns.
     * Column types are driver dependant.
     */
    mappedDataTypes: MappedColumnTypes = {
        createDate: "Timestamp",
        createDateDefault: "",
        updateDate: "Timestamp",
        updateDateDefault: "",
        deleteDate: "Timestamp",
        deleteDateNullable: true,
        version: "Int32",
        treeLevel: "Int32",
        migrationId: "Int32",
        migrationName: "Utf8",
        migrationTimestamp: "Int64",
        cacheId: "Int32",
        cacheIdentifier: "Utf8",
        cacheTime: "Int64",
        cacheDuration: "Int32",
        cacheQuery: "Utf8",
        cacheResult: "Utf8",
        metadataType: "Utf8",
        metadataDatabase: "Utf8",
        metadataSchema: "Utf8",
        metadataTable: "Utf8",
        metadataName: "Utf8",
        metadataValue: "Utf8",
    }

    /**
     * The prefix used for the parameters
     */
    parametersPrefix: string = "$p"

    /**
     * Default values of length, precision and scale depends on column data type.
     * Used in the cases when length/precision/scale is not specified by user.
     */
    dataTypeDefaults: DataTypeDefaults = {}

    cteCapabilities: CteCapabilities = {
        enabled: false,
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(dataSource: DataSource) {
        this.dataSource = dataSource
        this.options = dataSource.options as YdbDataSourceOptions

        this.validateOptions()
        this.loadDependencies()
    }

    // -------------------------------------------------------------------------
    // Public Methods
    // -------------------------------------------------------------------------

    /**
     * Performs connection to the database.
     */
    async connect(): Promise<void> {
        const connectionString = this.buildConnectionString()
        const credentialsProvider =
            this.createCredentialsProvider(connectionString)

        const ydb: YdbSdkDriver = new this.ydbCore.Driver(connectionString, {
            ...this.options.driverOptions,
            ...(credentialsProvider && { credentialsProvider }),
        })

        try {
            await ydb.ready(
                AbortSignal.timeout(this.options.connectTimeout ?? 10000),
            )
        } catch (error) {
            ydb.close()
            throw new TypeORMError(
                `Cannot connect to YDB at "${connectionString}": ${error?.message ?? error}`,
            )
        }

        this.ydb = ydb
        this.client = this.ydbQuery.query(ydb, {
            poolOptions: this.options.poolOptions,
        })
        this.database = ydb.database
    }

    /**
     * Makes any action after connection (e.g. create extensions in Postgres driver).
     */
    afterConnect(): Promise<void> {
        return Promise.resolve()
    }

    /**
     * Closes connection with the database.
     */
    async disconnect(): Promise<void> {
        const { ydb, client } = this
        this.client = undefined
        this.ydb = undefined

        try {
            await client?.[Symbol.asyncDispose]()
        } finally {
            ydb?.close()
        }
    }

    /**
     * Creates a schema builder used to build and sync a schema.
     */
    createSchemaBuilder() {
        return new RdbmsSchemaBuilder(this.dataSource)
    }

    /**
     * Creates a query runner used to execute database queries.
     *
     * @param mode
     */
    createQueryRunner(mode: ReplicationMode) {
        return new YdbQueryRunner(this, mode)
    }

    /**
     * Replaces parameters in the given sql with special escaping character
     * and an array of parameter names to be passed to a query.
     *
     * Null values are never sent as parameters, because YDB rejects untyped nulls:
     * "= :key" becomes "IS NULL", "!= :key" becomes "IS NOT NULL", otherwise "NULL" is inlined.
     *
     * @param sql
     * @param parameters
     */
    escapeQueryWithParameters(
        sql: string,
        parameters: ObjectLiteral,
    ): [string, any[]] {
        const escapedParameters: any[] = []
        if (!parameters || !Object.keys(parameters).length)
            return [sql, escapedParameters]

        const isNullParameter = (key: string) =>
            Object.hasOwn(parameters, key) &&
            (parameters[key] === null || parameters[key] === undefined)

        sql = sql
            .replaceAll(
                /\s*(?:!=|<>)\s*:([A-Za-z0-9_.]+)/g,
                (full, key: string) =>
                    isNullParameter(key) ? " IS NOT NULL" : full,
            )
            .replaceAll(
                /(?<![!<>=])\s*=\s*:([A-Za-z0-9_.]+)/g,
                (full, key: string) =>
                    isNullParameter(key) ? " IS NULL" : full,
            )

        const parameterIndexMap = new Map<string, number>()
        sql = sql.replaceAll(
            /:(\.\.\.)?([A-Za-z0-9_.]+)/g,
            (full, isArray: string, key: string): string => {
                if (!Object.hasOwn(parameters, key)) {
                    return full
                }

                if (parameterIndexMap.has(key)) {
                    return this.createParameter(
                        key,
                        parameterIndexMap.get(key)!,
                    )
                }

                const value: any = parameters[key]

                if (value === null || value === undefined) {
                    return "NULL"
                }

                if (isArray) {
                    return value
                        .map((v: any) => {
                            if (v === null || v === undefined) return "NULL"
                            escapedParameters.push(v)
                            return this.createParameter(
                                key,
                                escapedParameters.length - 1,
                            )
                        })
                        .join(", ")
                }

                if (typeof value === "function") {
                    return value()
                }

                escapedParameters.push(value)
                parameterIndexMap.set(key, escapedParameters.length - 1)
                return this.createParameter(key, escapedParameters.length - 1)
            },
        )

        return [sql, escapedParameters]
    }

    /**
     * Escapes a column name.
     *
     * @param columnName
     */
    escape(columnName: string): string {
        return "`" + columnName.replaceAll("`", "``") + "`"
    }

    /**
     * Build full table name with directory path (schema) and table name.
     * The database path is a part of the connection string, so it is not included.
     * E.g. "app/sub/table".
     *
     * @param tableName
     * @param schema
     */
    buildTableName(tableName: string, schema?: string): string {
        return schema ? `${schema}/${tableName}` : tableName
    }

    /**
     * Parse a target table name or other types and return a normalized table definition.
     * The schema is a directory path of the table inside the database.
     *
     * @param target
     */
    parseTableName(
        target: EntityMetadata | Table | View | TableForeignKey | string,
    ): { database?: string; schema?: string; tableName: string } {
        const driverDatabase = this.database

        if (target instanceof Table || target instanceof View) {
            const parsed = this.parseTableName(target.name)

            return {
                database: target.database ?? parsed.database ?? driverDatabase,
                schema: target.schema ?? parsed.schema,
                tableName: parsed.tableName,
            }
        }

        if (target instanceof TableForeignKey) {
            const parsed = this.parseTableName(target.referencedTableName)

            return {
                database:
                    target.referencedDatabase ??
                    parsed.database ??
                    driverDatabase,
                schema: target.referencedSchema ?? parsed.schema,
                tableName: parsed.tableName,
            }
        }

        if (target instanceof EntityMetadata) {
            // EntityMetadata tableName is never a path

            return {
                database: target.database ?? driverDatabase,
                schema: target.schema,
                tableName: target.tableName,
            }
        }

        const separatorIndex = target.lastIndexOf("/")

        return {
            database: driverDatabase,
            schema:
                separatorIndex > 0
                    ? target.slice(0, separatorIndex)
                    : undefined,
            tableName: target.slice(separatorIndex + 1),
        }
    }

    /**
     * Prepares given value to a value to be persisted, based on its column type and metadata.
     * Returns a typed YDB value, so the parameter type matches the column type.
     *
     * @param value
     * @param columnMetadata
     */
    preparePersistentValue(value: any, columnMetadata: ColumnMetadata): any {
        if (columnMetadata.transformer)
            value = ApplyValueTransformers.transformTo(
                columnMetadata.transformer,
                value,
            )

        return this.toColumnValue(value, columnMetadata)
    }

    /**
     * Prepares given value to a value to be hydrated, based on its column type or metadata.
     *
     * @param value
     * @param columnMetadata
     */
    prepareHydratedValue(value: any, columnMetadata: ColumnMetadata): any {
        if (value === null || value === undefined)
            return columnMetadata.transformer
                ? ApplyValueTransformers.transformFrom(
                      columnMetadata.transformer,
                      value,
                  )
                : value

        if (columnMetadata.type === "simple-array") {
            value = DateUtils.stringToSimpleArray(value)
        } else if (columnMetadata.type === "simple-json") {
            value = DateUtils.stringToSimpleJson(value)
        } else {
            switch (this.normalizeType(columnMetadata)) {
                case "Int64":
                case "Uint64":
                    value = String(value)
                    break
                case "Date":
                    value = DateUtils.mixedDateToDateString(value, {
                        utc: true,
                    })
                    break
                case "String":
                    value = Buffer.from(value)
                    break
            }
        }

        if (columnMetadata.transformer)
            value = ApplyValueTransformers.transformFrom(
                columnMetadata.transformer,
                value,
            )

        return value
    }

    /**
     * Wraps values of a find options "where" condition into typed YDB values
     * based on the column type, including values inside find operators.
     * Without it YDB would not compare, e.g., an Int64 column with a string value.
     *
     * @param column
     * @param value
     */
    parametrizeValues(column: ColumnMetadata, value: any): any {
        if (value instanceof FindOperator) {
            if (value.type !== "raw") {
                value.transformValue({
                    to: (v) => this.parametrizeValues(column, v),
                    from: (v) => v,
                })
            }

            return value
        }

        if (Array.isArray(value)) {
            return value.map((v) => this.parametrizeValues(column, v))
        }

        return this.toColumnValue(value, column)
    }

    /**
     * Creates a database type from a given column metadata.
     * Type names are case-insensitive like in YQL, common aliases of other databases are accepted.
     *
     * @param column
     * @param column.type
     * @param column.length
     * @param column.precision
     * @param column.scale
     */
    normalizeType(column: {
        type?: ColumnType | string
        length?: number | string
        precision?: number | null
        scale?: number
    }): string {
        const type = column.type

        if (type === Number) return "Int32"
        if (type === String) return "Utf8"
        if (type === Boolean) return "Bool"
        if (type === Date) return "Timestamp"
        if (
            typeof type === "function" &&
            ((type as Function) === Uint8Array ||
                type.prototype instanceof Uint8Array)
        )
            return "String"

        if (typeof type !== "string") return ""

        return YdbDriver.typeAliases[type.toLowerCase()] ?? type
    }

    /**
     * Normalizes "default" value of the column.
     *
     * @param columnMetadata
     */
    normalizeDefault(columnMetadata: ColumnMetadata): string | undefined {
        const defaultValue = columnMetadata.default

        if (defaultValue === null || defaultValue === undefined) {
            return undefined
        }

        if (
            typeof defaultValue === "number" ||
            typeof defaultValue === "boolean"
        ) {
            return `${defaultValue}`
        }

        if (typeof defaultValue === "function") {
            return defaultValue()
        }

        if (typeof defaultValue === "string") {
            return `'${defaultValue.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`
        }

        return `'${JSON.stringify(defaultValue)}'`
    }

    /**
     * Normalizes "isUnique" value of the column.
     *
     * @param column
     */
    normalizeIsUnique(column: ColumnMetadata): boolean {
        return column.entityMetadata.indices.some(
            (idx) =>
                idx.isUnique &&
                idx.columns.length === 1 &&
                idx.columns[0] === column,
        )
    }

    /**
     * Returns default column lengths, which is required on column creation.
     * YDB types have no length.
     */
    getColumnLength(): string {
        return ""
    }

    /**
     * Creates column type definition including length, precision and scale.
     * Length is not a part of YDB types, so it is omitted.
     *
     * @param column
     */
    createFullType(column: TableColumn): string {
        return column.type
    }

    /**
     * Obtains a new database connection to a master server.
     * Used for replication.
     * If replication is not setup then returns default connection's database connection.
     */
    async obtainMasterConnection(): Promise<any> {
        return this.client
    }

    /**
     * Obtains a new database connection to a slave server.
     * Used for replication.
     * If replication is not setup then returns master (default) connection's database connection.
     */
    async obtainSlaveConnection(): Promise<any> {
        return this.client
    }

    /**
     * Creates generated map of values generated or returned by database after INSERT query.
     */
    createGeneratedMap(): ObjectLiteral | undefined {
        throw new YdbNotImplementedError("createGeneratedMap")
    }

    /**
     * Differentiate columns of this table and columns from the given column metadatas columns
     * and returns only changed.
     */
    findChangedColumns(): ColumnMetadata[] {
        throw new YdbNotImplementedError("findChangedColumns")
    }

    /**
     * Returns true if driver supports RETURNING / OUTPUT statement.
     */
    isReturningSqlSupported(): boolean {
        return false
    }

    /**
     * Returns true if driver supports uuid values generation on its own.
     */
    isUUIDGenerationSupported(): boolean {
        return false
    }

    /**
     * Returns true if driver supports fulltext indices.
     */
    isFullTextColumnTypeSupported(): boolean {
        return false
    }

    /**
     * Creates an escaped parameter.
     *
     * @param _parameterName
     * @param index
     */
    createParameter(_parameterName: string, index: number): string {
        return this.parametersPrefix + index
    }

    // -------------------------------------------------------------------------
    // Protected Methods
    // -------------------------------------------------------------------------

    /**
     * Converts a value into a typed YDB value of the column type.
     * Null and undefined are returned as is: they are inlined into the query as NULL.
     *
     * @param value
     * @param column
     */
    protected toColumnValue(value: any, column: ColumnMetadata): any {
        if (value === null || value === undefined) return value

        const { primitive } = this.ydbValueModules

        if (column.type === "simple-array")
            return new primitive.Text(DateUtils.simpleArrayToString(value))
        if (column.type === "simple-json")
            return new primitive.Text(DateUtils.simpleJsonToString(value))

        if (isYdbValue(value)) return value

        const type = this.normalizeType(column)
        switch (type) {
            case "Bool":
                return new primitive.Bool(
                    typeof value === "string"
                        ? value === "true" || value === "1"
                        : Boolean(value),
                )
            case "Int8":
            case "Int16":
            case "Int32":
            case "Uint8":
            case "Uint16":
            case "Uint32": {
                const number = Number(value)
                if (!Number.isInteger(number)) {
                    throw new TypeORMError(
                        `YDB: value "${value}" of column "${column.propertyPath}" is not an integer.`,
                    )
                }
                return new primitive[type](number)
            }
            case "Int64":
            case "Uint64":
                return new primitive[type](BigInt(value))
            case "Float":
            case "Double":
                return new primitive[type](Number(value))
            case "Utf8":
                return new primitive.Text(String(value))
            case "String":
                return new primitive.Bytes(
                    value instanceof Uint8Array
                        ? value
                        : Buffer.from(String(value)),
                )
            case "Json":
            case "JsonDocument":
                return new primitive[type](JSON.stringify(value))
            case "Uuid":
                return new primitive.Uuid(String(value))
            case "Date":
                return new primitive.Date(this.toUtcDay(value, column.utc))
            case "Datetime":
            case "Timestamp":
                return new primitive[type](DateUtils.mixedDateToDate(value))
        }

        return value
    }

    /**
     * Converts a date into midnight UTC of the same calendar day.
     * YDB counts Date values as days since the epoch in UTC.
     *
     * @param value date object or "YYYY-MM-DD" string
     * @param utc take the calendar day of a date object in UTC instead of local time
     */
    protected toUtcDay(value: Date | string, utc: boolean): Date {
        if (typeof value === "string") {
            const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
            if (match)
                return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]))
            value = DateUtils.mixedDateToDate(value)
        }

        return utc
            ? new Date(
                  Date.UTC(
                      value.getUTCFullYear(),
                      value.getUTCMonth(),
                      value.getUTCDate(),
                  ),
              )
            : new Date(
                  Date.UTC(
                      value.getFullYear(),
                      value.getMonth(),
                      value.getDate(),
                  ),
              )
    }

    /**
     * Checks that the database is addressed in exactly one way.
     */
    protected validateOptions(): void {
        const { connectionString, host, port, database, ssl } = this.options
        const hasParts =
            host !== undefined ||
            port !== undefined ||
            database !== undefined ||
            ssl !== undefined

        if (connectionString !== undefined && hasParts) {
            throw new TypeORMError(
                `YDB: use either "connectionString" or "host", "port", "database" and "ssl" options, not both.`,
            )
        }

        if (connectionString === undefined && (!host || !database)) {
            throw new TypeORMError(
                `YDB: "connectionString" or "host" and "database" options are required.`,
            )
        }
    }

    /**
     * Builds a connection string from the options.
     */
    protected buildConnectionString(): string {
        const { connectionString, host, port, database, ssl } = this.options
        if (connectionString !== undefined) return connectionString

        const path = database!.startsWith("/") ? database : `/${database}`
        return `${ssl ? "grpcs" : "grpc"}://${host}:${port ?? 2136}${path}`
    }

    /**
     * Creates a credentials provider from the options.
     * Returns undefined for anonymous access.
     *
     * @param connectionString
     */
    protected createCredentialsProvider(
        connectionString: string,
    ): CredentialsProvider | undefined {
        const credentials = this.options.credentials
        if (!credentials) return undefined

        switch (credentials.type) {
            case "anonymous":
                return undefined
            case "static": {
                const { StaticCredentialsProvider } =
                    PlatformTools.load("@ydbjs/auth/static")
                return new StaticCredentialsProvider(
                    {
                        username: credentials.username,
                        password: credentials.password,
                    },
                    connectionString,
                    this.options.driverOptions?.secureOptions,
                )
            }
            case "access-token": {
                const { AccessTokenCredentialsProvider } = PlatformTools.load(
                    "@ydbjs/auth/access-token",
                )
                return new AccessTokenCredentialsProvider({
                    token: credentials.token,
                })
            }
            case "metadata": {
                const { MetadataCredentialsProvider } = PlatformTools.load(
                    "@ydbjs/auth/metadata",
                )
                return new MetadataCredentialsProvider({
                    endpoint: credentials.endpoint,
                    flavor: credentials.flavor,
                })
            }
            case "provider":
                return credentials.provider as CredentialsProvider
        }
    }

    /**
     * Loads all driver dependencies.
     */
    protected loadDependencies(): void {
        try {
            this.ydbCore = PlatformTools.load("@ydbjs/core")
            this.ydbQuery = PlatformTools.load("@ydbjs/query")
            this.ydbValueModules = {
                value: PlatformTools.load("@ydbjs/value"),
                primitive: PlatformTools.load("@ydbjs/value/primitive"),
                list: PlatformTools.load("@ydbjs/value/list"),
            }
            this.ydbStatsMode = PlatformTools.load("@ydbjs/api/query").StatsMode
            this.ydbError = PlatformTools.load("@ydbjs/error")
        } catch {
            throw new DriverPackageNotInstalledError(
                "YDB",
                "@ydbjs/core @ydbjs/query @ydbjs/value @ydbjs/api @ydbjs/auth @ydbjs/error",
            )
        }
    }
}
