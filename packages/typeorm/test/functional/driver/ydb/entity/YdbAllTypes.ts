import { Column } from "../../../../../src/decorator/columns/Column"
import { PrimaryColumn } from "../../../../../src/decorator/columns/PrimaryColumn"
import { Entity } from "../../../../../src/decorator/entity/Entity"

export const YDB_ALL_TYPES_DDL = `CREATE TABLE \`ydb_all_types\` (
    id Int32 NOT NULL,
    bool Bool,
    int8 Int8,
    int16 Int16,
    int32 Int32,
    int64 Int64,
    uint8 Uint8,
    uint16 Uint16,
    uint32 Uint32,
    uint64 Uint64,
    float Float,
    double Double,
    utf8 Utf8,
    bytes String,
    json Json,
    jsonDocument JsonDocument,
    uuid Uuid,
    date Date,
    datetime Datetime,
    timestamp Timestamp,
    tags Utf8,
    meta Utf8,
    nullableText Utf8,
    PRIMARY KEY (id)
)`

@Entity("ydb_all_types")
export class YdbAllTypes {
    @PrimaryColumn("Int32")
    id: number

    @Column("Bool", { nullable: true })
    bool: boolean | null

    @Column("Int8")
    int8: number

    @Column("Int16")
    int16: number

    // number without an explicit type is Int32
    @Column()
    int32: number

    @Column("Int64")
    int64: string

    @Column("Uint8")
    uint8: number

    @Column("Uint16")
    uint16: number

    @Column("Uint32")
    uint32: number

    @Column("Uint64")
    uint64: string

    @Column("Float")
    float: number

    @Column("Double")
    double: number

    // length is accepted and ignored
    @Column({ length: 255 })
    utf8: string

    @Column("String")
    bytes: Buffer

    @Column("Json")
    json: object

    @Column("JsonDocument")
    jsonDocument: object

    @Column("Uuid")
    uuid: string

    @Column("Date")
    date: string

    @Column("Datetime")
    datetime: Date

    @Column("Timestamp")
    timestamp: Date

    @Column("simple-array")
    tags: string[]

    @Column("simple-json")
    meta: { a: number }

    @Column({ type: "varchar", nullable: true })
    nullableText: string | null
}
