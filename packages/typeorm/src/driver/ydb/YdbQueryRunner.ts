import type { QueryStats } from "@ydbjs/api/query"
import type { YDBError } from "@ydbjs/error"
import type { QueryClient } from "@ydbjs/query"
import type { ObjectLiteral } from "../../common/ObjectLiteral"
import { NamedPlaceholdersNotSupportedError } from "../../error/NamedPlaceholdersNotSupportedError"
import { QueryFailedError } from "../../error/QueryFailedError"
import { QueryRunnerAlreadyReleasedError } from "../../error/QueryRunnerAlreadyReleasedError"
import { TypeORMError } from "../../error/TypeORMError"
import type { ReadStream } from "../../platform/PlatformTools"
import { BaseQueryRunner } from "../../query-runner/BaseQueryRunner"
import { QueryResult } from "../../query-runner/QueryResult"
import type { QueryRunner } from "../../query-runner/QueryRunner"
import type { Table } from "../../schema-builder/table/Table"
import type { View } from "../../schema-builder/view/View"
import { Broadcaster } from "../../subscriber/Broadcaster"
import { BroadcasterResult } from "../../subscriber/BroadcasterResult"
import type { ReplicationMode } from "../types/ReplicationMode"
import type { YdbDriver } from "./YdbDriver"
import { YdbNotImplementedError } from "./YdbNotImplementedError"
import { toYdbValue } from "./YdbParameters"

/**
 * Runs queries on a YDB database.
 */
export class YdbQueryRunner extends BaseQueryRunner implements QueryRunner {
    // -------------------------------------------------------------------------
    // Public Implemented Properties
    // -------------------------------------------------------------------------

    /**
     * Database driver used by connection.
     */
    driver: YdbDriver

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(driver: YdbDriver, mode: ReplicationMode) {
        super()
        this.driver = driver
        this.dataSource = driver.dataSource
        this.mode = mode
        this.broadcaster = new Broadcaster(this)
    }

    // -------------------------------------------------------------------------
    // Public Methods
    // -------------------------------------------------------------------------

    /**
     * Returns the query client of the driver.
     * Queries outside of a transaction are executed on the session pool of the client.
     */
    async connect(): Promise<QueryClient> {
        if (!this.driver.client) {
            throw new TypeORMError(`YDB driver is not connected`)
        }

        return this.driver.client
    }

    /**
     * Releases used database connection.
     * You cannot use query runner methods once its released.
     */
    async release(): Promise<void> {
        this.isReleased = true
    }

    /**
     * Executes a given SQL query.
     *
     * @param query
     * @param parameters
     * @param useStructuredResult
     */
    async query(
        query: string,
        parameters?: any[] | ObjectLiteral,
        useStructuredResult: boolean = false,
    ): Promise<any> {
        if (this.isReleased) throw new QueryRunnerAlreadyReleasedError()
        if (parameters && !Array.isArray(parameters))
            throw new NamedPlaceholdersNotSupportedError()

        const client = await this.connect()
        const ydbQuery = this.createYdbQuery(client, query, parameters ?? [])

        this.driver.dataSource.logger.logQuery(query, parameters, this)
        await this.broadcaster.broadcast("BeforeQuery", query, parameters)

        const broadcasterResult = new BroadcasterResult()

        try {
            const queryStartTime = Date.now()
            const resultSets: any[][] = await ydbQuery
            const queryExecutionTime = Date.now() - queryStartTime

            // log slow queries if maxQueryExecution time is set
            const maxQueryExecutionTime =
                this.driver.options.maxQueryExecutionTime
            if (
                maxQueryExecutionTime &&
                queryExecutionTime > maxQueryExecutionTime
            )
                this.driver.dataSource.logger.logQuerySlow(
                    queryExecutionTime,
                    query,
                    parameters,
                    this,
                )

            this.broadcaster.broadcastAfterQueryEvent(
                broadcasterResult,
                query,
                parameters,
                true,
                queryExecutionTime,
                resultSets,
                undefined,
            )

            const result = new QueryResult()
            result.raw = resultSets
            result.records = resultSets[0] ?? []
            result.affected = this.countAffectedRows(ydbQuery.stats())

            return useStructuredResult ? result : result.records
        } catch (err) {
            const driverError = this.findYdbError(err) ?? err

            this.driver.dataSource.logger.logQueryError(
                driverError,
                query,
                parameters,
                this,
            )
            this.broadcaster.broadcastAfterQueryEvent(
                broadcasterResult,
                query,
                parameters,
                false,
                undefined,
                undefined,
                driverError,
            )
            throw new QueryFailedError(query, parameters, driverError)
        } finally {
            await broadcasterResult.wait()
        }
    }

    // -------------------------------------------------------------------------
    // Not implemented yet
    // -------------------------------------------------------------------------

    async clearDatabase(): Promise<void> {
        throw new YdbNotImplementedError("clearDatabase")
    }

    async startTransaction(): Promise<void> {
        throw new YdbNotImplementedError("startTransaction")
    }

    async commitTransaction(): Promise<void> {
        throw new YdbNotImplementedError("commitTransaction")
    }

    async rollbackTransaction(): Promise<void> {
        throw new YdbNotImplementedError("rollbackTransaction")
    }

    async stream(): Promise<ReadStream> {
        throw new YdbNotImplementedError("stream")
    }

    async getDatabases(): Promise<string[]> {
        throw new YdbNotImplementedError("getDatabases")
    }

    async getSchemas(): Promise<string[]> {
        throw new YdbNotImplementedError("getSchemas")
    }

    async hasDatabase(): Promise<boolean> {
        throw new YdbNotImplementedError("hasDatabase")
    }

    async getCurrentDatabase(): Promise<string | undefined> {
        throw new YdbNotImplementedError("getCurrentDatabase")
    }

    async hasSchema(): Promise<boolean> {
        throw new YdbNotImplementedError("hasSchema")
    }

    async getCurrentSchema(): Promise<string | undefined> {
        throw new YdbNotImplementedError("getCurrentSchema")
    }

    async hasTable(): Promise<boolean> {
        throw new YdbNotImplementedError("hasTable")
    }

    async hasColumn(): Promise<boolean> {
        throw new YdbNotImplementedError("hasColumn")
    }

    async createDatabase(): Promise<void> {
        throw new YdbNotImplementedError("createDatabase")
    }

    async dropDatabase(): Promise<void> {
        throw new YdbNotImplementedError("dropDatabase")
    }

    async createSchema(): Promise<void> {
        throw new YdbNotImplementedError("createSchema")
    }

    async dropSchema(): Promise<void> {
        throw new YdbNotImplementedError("dropSchema")
    }

    async createTable(): Promise<void> {
        throw new YdbNotImplementedError("createTable")
    }

    async dropTable(): Promise<void> {
        throw new YdbNotImplementedError("dropTable")
    }

    async createView(): Promise<void> {
        throw new YdbNotImplementedError("createView")
    }

    async dropView(): Promise<void> {
        throw new YdbNotImplementedError("dropView")
    }

    async renameTable(): Promise<void> {
        throw new YdbNotImplementedError("renameTable")
    }

    async changeTableComment(): Promise<void> {
        throw new YdbNotImplementedError("changeTableComment")
    }

    async addColumn(): Promise<void> {
        throw new YdbNotImplementedError("addColumn")
    }

    async addColumns(): Promise<void> {
        throw new YdbNotImplementedError("addColumns")
    }

    async renameColumn(): Promise<void> {
        throw new YdbNotImplementedError("renameColumn")
    }

    async changeColumn(): Promise<void> {
        throw new YdbNotImplementedError("changeColumn")
    }

    async changeColumns(): Promise<void> {
        throw new YdbNotImplementedError("changeColumns")
    }

    async dropColumn(): Promise<void> {
        throw new YdbNotImplementedError("dropColumn")
    }

    async dropColumns(): Promise<void> {
        throw new YdbNotImplementedError("dropColumns")
    }

    async createPrimaryKey(): Promise<void> {
        throw new YdbNotImplementedError("createPrimaryKey")
    }

    async updatePrimaryKeys(): Promise<void> {
        throw new YdbNotImplementedError("updatePrimaryKeys")
    }

    async dropPrimaryKey(): Promise<void> {
        throw new YdbNotImplementedError("dropPrimaryKey")
    }

    async createUniqueConstraint(): Promise<void> {
        throw new YdbNotImplementedError("createUniqueConstraint")
    }

    async createUniqueConstraints(): Promise<void> {
        throw new YdbNotImplementedError("createUniqueConstraints")
    }

    async dropUniqueConstraint(): Promise<void> {
        throw new YdbNotImplementedError("dropUniqueConstraint")
    }

    async dropUniqueConstraints(): Promise<void> {
        throw new YdbNotImplementedError("dropUniqueConstraints")
    }

    async createCheckConstraint(): Promise<void> {
        throw new YdbNotImplementedError("createCheckConstraint")
    }

    async createCheckConstraints(): Promise<void> {
        throw new YdbNotImplementedError("createCheckConstraints")
    }

    async dropCheckConstraint(): Promise<void> {
        throw new YdbNotImplementedError("dropCheckConstraint")
    }

    async dropCheckConstraints(): Promise<void> {
        throw new YdbNotImplementedError("dropCheckConstraints")
    }

    async createExclusionConstraint(): Promise<void> {
        throw new YdbNotImplementedError("createExclusionConstraint")
    }

    async createExclusionConstraints(): Promise<void> {
        throw new YdbNotImplementedError("createExclusionConstraints")
    }

    async dropExclusionConstraint(): Promise<void> {
        throw new YdbNotImplementedError("dropExclusionConstraint")
    }

    async dropExclusionConstraints(): Promise<void> {
        throw new YdbNotImplementedError("dropExclusionConstraints")
    }

    async createForeignKey(): Promise<void> {
        throw new YdbNotImplementedError("createForeignKey")
    }

    async createForeignKeys(): Promise<void> {
        throw new YdbNotImplementedError("createForeignKeys")
    }

    async dropForeignKey(): Promise<void> {
        throw new YdbNotImplementedError("dropForeignKey")
    }

    async dropForeignKeys(): Promise<void> {
        throw new YdbNotImplementedError("dropForeignKeys")
    }

    async createIndex(): Promise<void> {
        throw new YdbNotImplementedError("createIndex")
    }

    async createIndices(): Promise<void> {
        throw new YdbNotImplementedError("createIndices")
    }

    async dropIndex(): Promise<void> {
        throw new YdbNotImplementedError("dropIndex")
    }

    async dropIndices(): Promise<void> {
        throw new YdbNotImplementedError("dropIndices")
    }

    async clearTable(): Promise<void> {
        throw new YdbNotImplementedError("clearTable")
    }

    // -------------------------------------------------------------------------
    // Protected Methods
    // -------------------------------------------------------------------------

    /**
     * Creates a YDB query with typed parameters.
     * Null parameters are inlined as `NULL`, because YDB rejects untyped nulls.
     *
     * @param client
     * @param query
     * @param parameters
     */
    protected createYdbQuery(
        client: QueryClient,
        query: string,
        parameters: any[],
    ) {
        const prefix = this.driver.parametersPrefix
        const text = query.replaceAll(
            /\$p(\d+)(?![0-9A-Za-z_])/g,
            (full, index: string) => {
                const value = parameters[Number(index)]
                return value === null || value === undefined ? "NULL" : full
            },
        )

        const ydbQuery = client(text).withStats(this.driver.ydbStatsMode.BASIC)
        parameters.forEach((value, index) => {
            if (value === null || value === undefined) return
            ydbQuery.parameter(
                prefix.slice(1) + index,
                toYdbValue(value, this.driver.ydbValueModules),
            )
        })

        return ydbQuery
    }

    /**
     * Counts rows written and deleted by the query.
     *
     * @param stats
     */
    protected countAffectedRows(stats: QueryStats | undefined): number {
        let affected = 0n
        for (const phase of stats?.queryPhases ?? []) {
            for (const table of phase.tableAccess) {
                affected +=
                    (table.updates?.rows ?? 0n) + (table.deletes?.rows ?? 0n)
            }
        }
        return Number(affected)
    }

    /**
     * Finds a YDB error in the cause chain and adds nested issues to its message.
     * By default the message contains only the top level issues, which are often not informative.
     *
     * @param error
     */
    protected findYdbError(error: unknown): YDBError | undefined {
        for (let current: any = error; current; current = current.cause) {
            if (current instanceof this.driver.ydbError.YDBError) {
                const details = this.describeIssues(current.issues)
                if (details && !current.message.includes(details))
                    current.message += `: ${details}`
                return current
            }
        }

        return undefined
    }

    /**
     * Joins nested issue messages, e.g. "Type annotation / At function: KiWriteTable! / Failed to convert".
     *
     * @param issues
     */
    protected describeIssues(issues: any[] | undefined): string {
        return (issues ?? [])
            .map((issue) =>
                [issue.message, this.describeIssues(issue.issues)]
                    .filter(Boolean)
                    .join(" / "),
            )
            .join("; ")
    }

    protected async loadTables(): Promise<Table[]> {
        throw new YdbNotImplementedError("loadTables")
    }

    protected async loadViews(): Promise<View[]> {
        throw new YdbNotImplementedError("loadViews")
    }
}
