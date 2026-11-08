import "reflect-metadata"
import { expect } from "chai"
import { DataSource } from "../../../../src/data-source/DataSource"
import { QueryFailedError } from "../../../../src/error/QueryFailedError"
import { TypeORMError } from "../../../../src/error/TypeORMError"
import type { YdbDataSourceOptions } from "../../../../src/driver/ydb/YdbDataSourceOptions"
import type { YdbDriver } from "../../../../src/driver/ydb/YdbDriver"
import { YdbNotImplementedError } from "../../../../src/driver/ydb/YdbNotImplementedError"
import { Table } from "../../../../src/schema-builder/table/Table"
import {
    closeTestingConnections,
    createTestingConnections,
    setupSingleTestingConnection,
} from "../../../utils/test-utils"

describe("driver > ydb > connection", () => {
    let dataSources: DataSource[]
    before(async () => {
        dataSources = await createTestingConnections({
            enabledDrivers: ["ydb"],
        })
    })
    after(() => closeTestingConnections(dataSources))

    it("should execute a query without parameters", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                const rows = await dataSource.query("SELECT 1 AS one")
                expect(rows).to.deep.equal([{ one: 1 }])
            }),
        ))

    it("should return a structured result", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                const queryRunner = dataSource.createQueryRunner()
                try {
                    const result = await queryRunner.query(
                        "SELECT 1 AS one; SELECT 2 AS two",
                        undefined,
                        true,
                    )
                    expect(result.records).to.deep.equal([{ one: 1 }])
                    expect(result.raw).to.deep.equal([
                        [{ one: 1 }],
                        [{ two: 2 }],
                    ])
                } finally {
                    await queryRunner.release()
                }
            }),
        ))

    it("should take the database path from the connection", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                const url = new URL(
                    (dataSource.options as YdbDataSourceOptions)
                        .connectionString!,
                )
                expect(dataSource.driver.database).to.equal(url.pathname)
            }),
        ))

    it("should wrap database errors into QueryFailedError", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                await expect(dataSource.query("SELECT * FROM `no_such_table`"))
                    .to.be.rejectedWith(QueryFailedError)
                    .and.eventually.have.property("code")
            }),
        ))

    it("should throw for not implemented features", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                const queryRunner = dataSource.createQueryRunner()
                try {
                    await expect(
                        queryRunner.createTable(new Table({ name: "t" })),
                    ).to.be.rejectedWith(
                        YdbNotImplementedError,
                        "createTable is not implemented yet",
                    )
                    await expect(
                        queryRunner.query("SELECT $p0", [1]),
                    ).to.be.rejectedWith(YdbNotImplementedError)
                } finally {
                    await queryRunner.release()
                }
            }),
        ))

    it("should escape identifiers and build table paths", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                const driver = dataSource.driver as YdbDriver
                expect(driver.escape("a`b")).to.equal("`a``b`")
                expect(driver.buildTableName("t", "app/sub")).to.equal(
                    "app/sub/t",
                )
                expect(driver.parseTableName("app/sub/t")).to.include({
                    schema: "app/sub",
                    tableName: "t",
                })
                expect(driver.parseTableName("t")).to.include({
                    schema: undefined,
                    tableName: "t",
                })
            }),
        ))
})

describe("driver > ydb > connection options", () => {
    const options = setupSingleTestingConnection("ydb", {}) as
        YdbDataSourceOptions | undefined

    it("should connect using host, port and database", async () => {
        if (!options) return

        const url = new URL(options.connectionString!)
        const dataSource = new DataSource({
            ...options,
            connectionString: undefined,
            host: url.hostname,
            port: Number(url.port),
            database: url.pathname,
        })

        await dataSource.initialize()
        try {
            expect(await dataSource.query("SELECT 1 AS one")).to.deep.equal([
                { one: 1 },
            ])
            expect(dataSource.driver.database).to.equal(url.pathname)
        } finally {
            await dataSource.destroy()
        }
    })

    it("should reject conflicting or missing address options", () => {
        if (!options) return

        expect(
            () => new DataSource({ ...options, host: "localhost" }),
        ).to.throw(TypeORMError, "not both")
        expect(
            () =>
                new DataSource({
                    ...options,
                    connectionString: undefined,
                }),
        ).to.throw(TypeORMError, "are required")
    })

    it("should fail fast when the database is unreachable", async () => {
        if (!options) return

        const dataSource = new DataSource({
            ...options,
            connectionString: "grpc://127.0.0.1:1/local",
            connectTimeout: 1000,
        })

        const startedAt = Date.now()
        await expect(dataSource.initialize()).to.be.rejectedWith(
            TypeORMError,
            "Cannot connect to YDB",
        )
        expect(Date.now() - startedAt).to.be.lessThan(5000)
        expect(dataSource.isInitialized).to.equal(false)
    })

    it("should not run queries after destroy", async () => {
        if (!options) return

        const dataSource = new DataSource(options)
        await dataSource.initialize()
        await dataSource.destroy()

        expect(dataSource.isInitialized).to.equal(false)
        await expect(dataSource.query("SELECT 1")).to.be.rejectedWith(
            TypeORMError,
        )
    })
})
