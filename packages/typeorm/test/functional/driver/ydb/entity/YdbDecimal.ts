import { Column } from "../../../../../src/decorator/columns/Column"
import { PrimaryColumn } from "../../../../../src/decorator/columns/PrimaryColumn"
import { Entity } from "../../../../../src/decorator/entity/Entity"

@Entity("ydb_decimal")
export class YdbDecimal {
    @PrimaryColumn("Int32")
    id: number

    @Column("decimal")
    price: string
}
