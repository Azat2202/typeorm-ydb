import type { CredentialsProvider } from "@ydbjs/auth"
import type { Driver as YdbSdkDriver } from "@ydbjs/core"
import type { QueryClient } from "@ydbjs/query"
import type { ObjectLiteral } from "../../common/ObjectLiteral"
import type { DataSource } from "../../data-source"
import { DriverPackageNotInstalledError } from "../../error/DriverPackageNotInstalledError"
import { TypeORMError } from "../../error/TypeORMError"
import type { ColumnMetadata } from "../../metadata/ColumnMetadata"
import { EntityMetadata } from "../../metadata/EntityMetadata"
import { PlatformTools } from "../../platform/PlatformTools"
import { RdbmsSchemaBuilder } from "../../schema-builder/RdbmsSchemaBuilder"
import { Table } from "../../schema-builder/table/Table"
import { TableForeignKey } from "../../schema-builder/table/TableForeignKey"
import { View } from "../../schema-builder/view/View"
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
import { YdbQueryRunner } from "./YdbQueryRunner"

/**
 * Organizes communication with YDB.
 */
export class YdbDriver implements Driver {
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
     */
    supportedDataTypes: ColumnType[] = []

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
     */
    withLengthColumnTypes: ColumnType[] = []

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
        createDate: "timestamp",
        createDateDefault: "",
        updateDate: "timestamp",
        updateDateDefault: "",
        deleteDate: "timestamp",
        deleteDateNullable: true,
        version: "int64",
        treeLevel: "int64",
        migrationId: "int64",
        migrationName: "text",
        migrationTimestamp: "int64",
        cacheId: "text",
        cacheIdentifier: "text",
        cacheTime: "int64",
        cacheDuration: "int64",
        cacheQuery: "text",
        cacheResult: "text",
        metadataType: "text",
        metadataDatabase: "text",
        metadataSchema: "text",
        metadataTable: "text",
        metadataName: "text",
        metadataValue: "text",
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
     */
    escapeQueryWithParameters(): [string, any[]] {
        throw new YdbNotImplementedError("escapeQueryWithParameters")
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
     */
    preparePersistentValue(): any {
        throw new YdbNotImplementedError("preparePersistentValue")
    }

    /**
     * Prepares given value to a value to be hydrated, based on its column type or metadata.
     */
    prepareHydratedValue(): any {
        throw new YdbNotImplementedError("prepareHydratedValue")
    }

    /**
     * Creates a database type from a given column metadata.
     */
    normalizeType(): string {
        throw new YdbNotImplementedError("normalizeType")
    }

    /**
     * Normalizes "default" value of the column.
     */
    normalizeDefault(): string | undefined {
        throw new YdbNotImplementedError("normalizeDefault")
    }

    /**
     * Normalizes "isUnique" value of the column.
     */
    normalizeIsUnique(): boolean {
        throw new YdbNotImplementedError("normalizeIsUnique")
    }

    /**
     * Returns default column lengths, which is required on column creation.
     */
    getColumnLength(): string {
        throw new YdbNotImplementedError("getColumnLength")
    }

    /**
     * Creates column type definition including length, precision and scale
     */
    createFullType(): string {
        throw new YdbNotImplementedError("createFullType")
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
     */
    createParameter(): string {
        throw new YdbNotImplementedError("createParameter")
    }

    // -------------------------------------------------------------------------
    // Protected Methods
    // -------------------------------------------------------------------------

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
        } catch {
            throw new DriverPackageNotInstalledError(
                "YDB",
                "@ydbjs/core @ydbjs/query @ydbjs/value @ydbjs/api @ydbjs/auth @ydbjs/error",
            )
        }
    }
}
