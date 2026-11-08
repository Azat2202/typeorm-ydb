import type { Value } from "@ydbjs/value"
import { TypeORMError } from "../../error/TypeORMError"

const INT32_MIN = -(2 ** 31)
const INT32_MAX = 2 ** 31 - 1
const INT64_MIN = -(2n ** 63n)
const INT64_MAX = 2n ** 63n - 1n
const UINT64_MAX = 2n ** 64n - 1n

/**
 * Modules of `@ydbjs/value` used to build query parameters.
 */
export interface YdbValueModules {
    /**
     * `@ydbjs/value`.
     */
    value: any

    /**
     * `@ydbjs/value/primitive`.
     */
    primitive: any

    /**
     * `@ydbjs/value/list`.
     */
    list: any
}

/**
 * Returns true if the given value is already a YDB value (e.g. `new Int64(1n)`).
 *
 * @param value
 */
export function isYdbValue(value: unknown): value is Value {
    return (
        typeof value === "object" &&
        value !== null &&
        "type" in value &&
        typeof (value as { encode?: unknown }).encode === "function"
    )
}

/**
 * Converts a JavaScript value into a typed YDB query parameter.
 * Used for parameters without column metadata (raw queries, where conditions).
 *
 * `null` and `undefined` are not accepted: YDB rejects untyped nulls,
 * so they are inlined into the query text as `NULL` instead.
 *
 * @param value
 * @param modules
 */
export function toYdbValue(value: unknown, modules: YdbValueModules): Value {
    const { Bool, Bytes, Double, Int32, Int64, Text, Timestamp, Uint64 } =
        modules.primitive

    if (isYdbValue(value)) return value

    switch (typeof value) {
        case "boolean":
            return new Bool(value)

        case "number":
            if (!Number.isInteger(value)) return new Double(value)
            if (value < INT32_MIN || value > INT32_MAX) {
                throw new TypeORMError(
                    `YDB: integer ${value} does not fit into Int32. ` +
                        `Pass it as a bigint (sent as Int64) or as a typed value, e.g. new Int64(${value}n) from "@ydbjs/value/primitive".`,
                )
            }
            return new Int32(value)

        case "bigint":
            if (value >= INT64_MIN && value <= INT64_MAX)
                return new Int64(value)
            if (value > INT64_MAX && value <= UINT64_MAX)
                return new Uint64(value)
            throw new TypeORMError(
                `YDB: integer ${value} does not fit into Int64 or Uint64.`,
            )

        case "string":
            return new Text(value)

        case "object": {
            if (value === null) break

            if (value instanceof Date) {
                if (Number.isNaN(value.getTime())) {
                    throw new TypeORMError(`YDB: invalid date parameter.`)
                }
                return new Timestamp(value)
            }

            if (value instanceof Uint8Array) return new Bytes(value)

            if (Array.isArray(value)) {
                if (value.some((item) => item === null || item === undefined)) {
                    throw new TypeORMError(
                        `YDB: array parameters cannot contain null or undefined.`,
                    )
                }
                return new modules.list.List(
                    ...value.map((item) => toYdbValue(item, modules)),
                )
            }

            return modules.value.fromJs(value)
        }
    }

    throw new TypeORMError(
        `YDB: cannot convert parameter of type "${value === null ? "null" : typeof value}" to a YDB value.`,
    )
}
