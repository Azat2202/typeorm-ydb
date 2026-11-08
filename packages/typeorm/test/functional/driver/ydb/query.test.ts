import "reflect-metadata"
import { expect } from "chai"
import { Int64, Uint64, Uuid } from "@ydbjs/value/primitive"
import { DataSource } from "../../../../src/data-source/DataSource"
import type { YdbDataSourceOptions } from "../../../../src/driver/ydb/YdbDataSourceOptions"
import { NamedPlaceholdersNotSupportedError } from "../../../../src/error/NamedPlaceholdersNotSupportedError"
import { QueryFailedError } from "../../../../src/error/QueryFailedError"
import { TypeORMError } from "../../../../src/error/TypeORMError"
import type { Logger } from "../../../../src/logger/Logger"
import {
    closeTestingConnections,
    createTestingConnections,
    setupSingleTestingConnection,
} from "../../../utils/test-utils"

const TABLE = "ydb_query_test"

describe("driver > ydb > query", () => {
    let dataSources: DataSource[]
    before(async () => {
        dataSources = await createTestingConnections({
            enabledDrivers: ["ydb"],
        })
        for (const dataSource of dataSources) {
            await dataSource.query(`DROP TABLE IF EXISTS \`${TABLE}\``)
            await dataSource.query(
                `CREATE TABLE \`${TABLE}\` (id Int32 NOT NULL, big Int64, name Utf8, created Timestamp, flag Bool, PRIMARY KEY (id))`,
            )
        }
    })
    beforeEach(() =>
        Promise.all(
            dataSources.map((dataSource) =>
                dataSource.query(`DELETE FROM \`${TABLE}\``),
            ),
        ),
    )
    after(async () => {
        for (const dataSource of dataSources ?? []) {
            await dataSource.query(`DROP TABLE IF EXISTS \`${TABLE}\``)
        }
        await closeTestingConnections(dataSources)
    })

    const selectValue = async (dataSource: DataSource, value: unknown) => {
        const rows = await dataSource.query("SELECT $p0 AS v", [value])
        return rows[0].v
    }

    /**
     * Inserts rows through escapeQueryWithParameters, the same way query builders do.
     *
     * @param dataSource
     * @param rows
     */
    const insert = async (dataSource: DataSource, rows: object[]) => {
        for (const row of rows) {
            const [sql, parameters] =
                dataSource.driver.escapeQueryWithParameters(
                    `UPSERT INTO \`${TABLE}\` (id, big, name, created, flag) VALUES (:id, :big, :name, :created, :flag)`,
                    {
                        big: null,
                        name: null,
                        created: null,
                        flag: null,
                        ...row,
                    },
                )
            await dataSource.query(sql, parameters)
        }
    }

    it("should send parameters of basic types", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                expect(await selectValue(dataSource, true)).to.equal(true)
                expect(await selectValue(dataSource, 42)).to.equal(42)
                expect(await selectValue(dataSource, -7)).to.equal(-7)
                expect(await selectValue(dataSource, 1.5)).to.equal(1.5)
                expect(
                    await selectValue(dataSource, 9007199254740993n),
                ).to.equal(9007199254740993n)
                expect(await selectValue(dataSource, "Привет 👋")).to.equal(
                    "Привет 👋",
                )

                const date = new Date("2026-01-02T03:04:05.678Z")
                const loadedDate = await selectValue(dataSource, date)
                expect(loadedDate).to.be.instanceOf(Date)
                expect(loadedDate.getTime()).to.equal(date.getTime())

                const bytes = await selectValue(
                    dataSource,
                    Buffer.from([1, 2, 3]),
                )
                expect(Buffer.from(bytes).equals(Buffer.from([1, 2, 3]))).to.be
                    .true

                expect(await selectValue(dataSource, null)).to.equal(null)
            }),
        ))

    it("should pass typed YDB values as is", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                const uuid = "8ddaba6a-7463-4562-af79-ee00819060e5"
                expect(await selectValue(dataSource, new Uuid(uuid))).to.equal(
                    uuid,
                )
                expect(await selectValue(dataSource, new Int64(5n))).to.equal(
                    5n,
                )
                expect(
                    await selectValue(
                        dataSource,
                        new Uint64(18446744073709551615n),
                    ),
                ).to.equal(18446744073709551615n)
            }),
        ))

    it("should reject integers that do not fit into Int32", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                await expect(
                    selectValue(dataSource, 2 ** 31),
                ).to.be.rejectedWith(TypeORMError, "does not fit into Int32")
            }),
        ))

    it("should write and read rows with named parameters", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                const created = new Date("2026-03-04T05:06:07.890Z")
                await insert(dataSource, [
                    // Int32 parameter is widened into the Int64 column
                    { id: 1, big: 5, name: "first", created, flag: true },
                    { id: 2, big: 9007199254740993n, name: "second" },
                    { id: 3 },
                ])

                const [sql, parameters] =
                    dataSource.driver.escapeQueryWithParameters(
                        `SELECT id, big, name, created, flag FROM \`${TABLE}\` WHERE id IN (:...ids) ORDER BY id`,
                        { ids: [1, 2, 3] },
                    )
                expect(sql).to.contain("IN ($p0, $p1, $p2)")

                const rows = await dataSource.query(sql, parameters)
                expect(rows).to.have.length(3)
                expect(rows[0]).to.deep.include({
                    id: 1,
                    big: 5n,
                    name: "first",
                    flag: true,
                })
                expect(rows[0].created.getTime()).to.equal(created.getTime())
                expect(rows[1].big).to.equal(9007199254740993n)
                expect(rows[2]).to.deep.include({
                    id: 3,
                    big: null,
                    name: null,
                    created: null,
                    flag: null,
                })
            }),
        ))

    it("should turn null comparisons into IS NULL and IS NOT NULL", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                await insert(dataSource, [{ id: 1, name: "a" }, { id: 2 }])

                const select = async (condition: string) => {
                    const [sql, parameters] =
                        dataSource.driver.escapeQueryWithParameters(
                            `SELECT id FROM \`${TABLE}\` WHERE ${condition} ORDER BY id`,
                            { name: null },
                        )
                    return {
                        sql,
                        ids: (await dataSource.query(sql, parameters)).map(
                            (row: { id: number }) => row.id,
                        ),
                    }
                }

                const isNull = await select("name = :name")
                expect(isNull.sql).to.contain("name IS NULL")
                expect(isNull.ids).to.deep.equal([2])

                const isNotNull = await select("name != :name")
                expect(isNotNull.sql).to.contain("name IS NOT NULL")
                expect(isNotNull.ids).to.deep.equal([1])
            }),
        ))

    it("should run query builder queries with parameters", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                await insert(dataSource, [
                    { id: 1, name: "a" },
                    { id: 2, name: "b" },
                    { id: 3 },
                ])

                const rows = await dataSource
                    .createQueryBuilder()
                    .select("t.id", "id")
                    .from(TABLE, "t")
                    .where("t.id IN (:...ids)", { ids: [1, 2, 3] })
                    .andWhere("t.name != :name", { name: "a" })
                    .orderBy("t.id")
                    .getRawMany()

                expect(rows).to.deep.equal([{ id: 2 }])
            }),
        ))

    it("should reuse repeated parameters and inline functions", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                const [sql, parameters] =
                    dataSource.driver.escapeQueryWithParameters(
                        "SELECT :a AS x, :a AS y, :b AS z, :fn AS w",
                        { a: 1, b: "two", fn: () => "1 + 1" },
                    )
                expect(sql).to.equal(
                    "SELECT $p0 AS x, $p0 AS y, $p1 AS z, 1 + 1 AS w",
                )
                expect(parameters).to.deep.equal([1, "two"])
                expect(await dataSource.query(sql, parameters)).to.deep.equal([
                    { x: 1, y: 1, z: "two", w: 2 },
                ])
            }),
        ))

    it("should report affected rows", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                await insert(dataSource, [{ id: 1 }, { id: 2 }, { id: 3 }])
                const queryRunner = dataSource.createQueryRunner()
                try {
                    const updated = await queryRunner.query(
                        `UPDATE \`${TABLE}\` SET name = $p0 WHERE id < $p1`,
                        ["x", 3],
                        true,
                    )
                    expect(updated.affected).to.equal(2)

                    const deleted = await queryRunner.query(
                        `DELETE FROM \`${TABLE}\` WHERE id = $p0`,
                        [3],
                        true,
                    )
                    expect(deleted.affected).to.equal(1)

                    const selected = await queryRunner.query(
                        `SELECT * FROM \`${TABLE}\``,
                        [],
                        true,
                    )
                    expect(selected.affected).to.equal(0)
                    expect(selected.records).to.have.length(2)
                } finally {
                    await queryRunner.release()
                }
            }),
        ))

    it("should return all result sets in raw result", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                const queryRunner = dataSource.createQueryRunner()
                try {
                    const result = await queryRunner.query(
                        "SELECT $p0 AS a; SELECT $p1 AS b",
                        [1, "two"],
                        true,
                    )
                    expect(result.records).to.deep.equal([{ a: 1 }])
                    expect(result.raw).to.deep.equal([
                        [{ a: 1 }],
                        [{ b: "two" }],
                    ])
                } finally {
                    await queryRunner.release()
                }
            }),
        ))

    it("should support the sql tagged template", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                const value = "x"
                const rows =
                    await dataSource.sql`SELECT ${1} AS a, ${value} AS b, ${null} AS c`
                expect(rows).to.deep.equal([{ a: 1, b: "x", c: null }])
            }),
        ))

    it("should reject named parameters objects", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                await expect(
                    dataSource.query("SELECT $p0", { p0: 1 } as any),
                ).to.be.rejectedWith(NamedPlaceholdersNotSupportedError)
            }),
        ))

    it("should expose code, issues and nested messages of YDB errors", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                // Int64 is not narrowed into the Int32 primary key column
                const error = await dataSource
                    .query(`UPSERT INTO \`${TABLE}\` (id) VALUES ($p0)`, [
                        new Int64(1n),
                    ])
                    .catch((e: unknown) => e)

                expect(error).to.be.instanceOf(QueryFailedError)
                expect(error).to.have.property("code").that.is.a("number")
                expect(error).to.have.property("issues").that.is.an("array")
                    .that.is.not.empty
                expect((error as Error).message).to.contain("Failed to convert")
            }),
        ))
})

describe("driver > ydb > query logging", () => {
    const options = setupSingleTestingConnection("ydb", {}) as
        YdbDataSourceOptions | undefined

    it("should log queries, slow queries and errors", async () => {
        if (!options) return

        const calls: { method: string; query: string }[] = []
        const logger: Logger = {
            logQuery: (query) => calls.push({ method: "logQuery", query }),
            logQueryError: (_error, query) =>
                calls.push({ method: "logQueryError", query }),
            logQuerySlow: (_time, query) =>
                calls.push({ method: "logQuerySlow", query }),
            logSchemaBuild: () => undefined,
            logMigration: () => undefined,
            log: () => undefined,
        }

        const dataSource = new DataSource({
            ...options,
            logger,
            maxQueryExecutionTime: 1,
        })
        await dataSource.initialize()
        try {
            await dataSource.query("SELECT $p0 AS v", [1])
            await dataSource
                .query("SELECT * FROM `no_such_table`")
                .catch(() => undefined)
        } finally {
            await dataSource.destroy()
        }

        expect(calls).to.deep.include({
            method: "logQuery",
            query: "SELECT $p0 AS v",
        })
        expect(calls).to.deep.include({
            method: "logQuerySlow",
            query: "SELECT $p0 AS v",
        })
        expect(calls).to.deep.include({
            method: "logQueryError",
            query: "SELECT * FROM `no_such_table`",
        })
    })
})
