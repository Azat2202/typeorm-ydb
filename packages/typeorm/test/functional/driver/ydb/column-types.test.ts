import "reflect-metadata"
import { expect } from "chai"
import { DataSource } from "../../../../src/data-source/DataSource"
import type { YdbDataSourceOptions } from "../../../../src/driver/ydb/YdbDataSourceOptions"
import type { YdbDriver } from "../../../../src/driver/ydb/YdbDriver"
import { DataTypeNotSupportedError } from "../../../../src/error/DataTypeNotSupportedError"
import { In } from "../../../../src/find-options/operator/In"
import { IsNull } from "../../../../src/find-options/operator/IsNull"
import { MoreThan } from "../../../../src/find-options/operator/MoreThan"
import {
    closeTestingConnections,
    createTestingConnections,
    setupSingleTestingConnection,
} from "../../../utils/test-utils"
import { YDB_ALL_TYPES_DDL, YdbAllTypes } from "./entity/YdbAllTypes"
import { YdbDecimal } from "./entity/YdbDecimal"

const createRow = (id: number): YdbAllTypes =>
    Object.assign(new YdbAllTypes(), {
        id,
        bool: true,
        int8: -128,
        int16: 32767,
        int32: -2147483648,
        int64: "9007199254740993",
        uint8: 255,
        uint16: 65535,
        uint32: 4294967295,
        uint64: "18446744073709551615",
        float: 1.5,
        double: 0.1,
        utf8: "Привет 👋",
        bytes: Buffer.from([0, 1, 254, 255]),
        json: { a: 1, b: [true, null] },
        jsonDocument: { nested: { x: "y" } },
        uuid: "8ddaba6a-7463-4562-af79-ee00819060e5",
        date: "2026-01-02",
        datetime: new Date("2026-01-02T03:04:05.000Z"),
        timestamp: new Date("2026-01-02T03:04:05.678Z"),
        tags: ["a", "b"],
        meta: { a: 1 },
        nullableText: "text",
    })

describe("driver > ydb > column types", () => {
    let dataSources: DataSource[]
    before(async () => {
        dataSources = await createTestingConnections({
            entities: [YdbAllTypes],
            enabledDrivers: ["ydb"],
        })
        for (const dataSource of dataSources) {
            await dataSource.query("DROP TABLE IF EXISTS `ydb_all_types`")
            await dataSource.query(YDB_ALL_TYPES_DDL)
        }
    })
    beforeEach(() =>
        Promise.all(
            dataSources.map((dataSource) =>
                dataSource.query("DELETE FROM `ydb_all_types`"),
            ),
        ),
    )
    after(async () => {
        for (const dataSource of dataSources ?? []) {
            await dataSource.query("DROP TABLE IF EXISTS `ydb_all_types`")
        }
        await closeTestingConnections(dataSources)
    })

    const insert = (dataSource: DataSource, rows: YdbAllTypes[]) =>
        dataSource
            .createQueryBuilder()
            .insert()
            .into(YdbAllTypes)
            .values(rows)
            .updateEntity(false)
            .execute()

    it("should persist and hydrate all supported types", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                const row = createRow(1)
                await insert(dataSource, [row])

                const loaded = await dataSource
                    .getRepository(YdbAllTypes)
                    .findOneByOrFail({ id: 1 })

                expect(loaded).to.deep.equal(row)
                expect(loaded.bytes).to.be.instanceOf(Buffer)
                expect(loaded.timestamp.getTime()).to.equal(
                    row.timestamp.getTime(),
                )
            }),
        ))

    it("should persist and hydrate nulls", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                await insert(dataSource, [
                    Object.assign(createRow(1), {
                        bool: null,
                        nullableText: null,
                    }),
                ])

                const loaded = await dataSource
                    .getRepository(YdbAllTypes)
                    .findOneByOrFail({ id: 1 })

                expect(loaded.bool).to.equal(null)
                expect(loaded.nullableText).to.equal(null)
            }),
        ))

    it("should update values with typed parameters", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                await insert(dataSource, [createRow(1)])

                const timestamp = new Date("2027-05-06T07:08:09.123Z")
                await dataSource
                    .createQueryBuilder()
                    .update(YdbAllTypes)
                    .set({
                        int64: "-42",
                        timestamp,
                        tags: ["c"],
                        date: "2027-05-06",
                    })
                    .where("id = :id", { id: 1 })
                    .updateEntity(false)
                    .execute()

                const loaded = await dataSource
                    .getRepository(YdbAllTypes)
                    .findOneByOrFail({ id: 1 })

                expect(loaded.int64).to.equal("-42")
                expect(loaded.timestamp.getTime()).to.equal(timestamp.getTime())
                expect(loaded.tags).to.deep.equal(["c"])
                expect(loaded.date).to.equal("2027-05-06")
            }),
        ))

    it("should type find options values by column", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                await insert(dataSource, [
                    createRow(1),
                    Object.assign(createRow(2), {
                        int64: "2",
                        timestamp: new Date("2020-01-01T00:00:00.000Z"),
                        nullableText: null,
                        uuid: "00000000-0000-0000-0000-000000000002",
                        date: "2020-01-01",
                    }),
                ])
                const repository = dataSource.getRepository(YdbAllTypes)
                const ids = async (where: object) =>
                    (
                        await repository.find({ where, order: { id: "ASC" } })
                    ).map((row) => row.id)

                expect(await ids({ int64: "9007199254740993" })).to.deep.equal([
                    1,
                ])
                expect(
                    await ids({ int64: In(["2", "9007199254740993"]) }),
                ).to.deep.equal([1, 2])
                expect(
                    await ids({
                        timestamp: MoreThan(new Date("2025-01-01T00:00:00Z")),
                    }),
                ).to.deep.equal([1])
                expect(await ids({ nullableText: IsNull() })).to.deep.equal([2])
                expect(
                    await ids({ uuid: "00000000-0000-0000-0000-000000000002" }),
                ).to.deep.equal([2])
                expect(await ids({ date: "2026-01-02" })).to.deep.equal([1])
                expect(
                    await ids({ uint64: "18446744073709551615" }),
                ).to.deep.equal([1, 2])
            }),
        ))

    it("should normalize type names and aliases", () =>
        Promise.all(
            dataSources.map(async (dataSource) => {
                const driver = dataSource.driver as YdbDriver
                const normalize = (type: any) => driver.normalizeType({ type })

                expect(normalize(Number)).to.equal("Int32")
                expect(normalize(String)).to.equal("Utf8")
                expect(normalize(Boolean)).to.equal("Bool")
                expect(normalize(Date)).to.equal("Timestamp")
                expect(normalize(Buffer)).to.equal("String")
                expect(normalize("int64")).to.equal("Int64")
                expect(normalize("BIGINT")).to.equal("Int64")
                expect(normalize("varchar")).to.equal("Utf8")
                expect(normalize("text")).to.equal("Utf8")
                expect(normalize("string")).to.equal("String")
                expect(normalize("jsonb")).to.equal("JsonDocument")
                expect(normalize("simple-json")).to.equal("Utf8")
                expect(normalize("decimal")).to.equal("Decimal")
                expect(normalize("unknown")).to.equal("unknown")
            }),
        ))
})

describe("driver > ydb > unsupported column types", () => {
    const options = setupSingleTestingConnection("ydb", {}) as
        YdbDataSourceOptions | undefined

    it("should reject decimal columns until the driver decodes them", async () => {
        if (!options) return

        const dataSource = new DataSource({
            ...options,
            entities: [YdbDecimal],
        })

        await expect(dataSource.initialize()).to.be.rejectedWith(
            DataTypeNotSupportedError,
        )
        if (dataSource.isInitialized) await dataSource.destroy()
    })
})
