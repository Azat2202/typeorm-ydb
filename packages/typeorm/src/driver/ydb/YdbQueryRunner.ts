import type { QueryClient } from "@ydbjs/query"
import type { ObjectLiteral } from "../../common/ObjectLiteral"
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
import type { ReplicationMode } from "../types/ReplicationMode"
import type { YdbDriver } from "./YdbDriver"
import { YdbNotImplementedError } from "./YdbNotImplementedError"

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
        if (parameters && Object.keys(parameters).length > 0)
            throw new YdbNotImplementedError("query parameters")

        const client = await this.connect()

        this.driver.dataSource.logger.logQuery(query, parameters, this)

        try {
            const resultSets: any[][] = await client(query)

            const result = new QueryResult()
            result.raw = resultSets
            result.records = resultSets[0] ?? []

            return useStructuredResult ? result : result.records
        } catch (err) {
            this.driver.dataSource.logger.logQueryError(
                err,
                query,
                parameters,
                this,
            )
            throw new QueryFailedError(query, parameters, err)
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

    protected async loadTables(): Promise<Table[]> {
        throw new YdbNotImplementedError("loadTables")
    }

    protected async loadViews(): Promise<View[]> {
        throw new YdbNotImplementedError("loadViews")
    }
}
