const { setupMonocle } = require("../../dist");
setupMonocle("adk.travel.agent");

const { FunctionTool } = require("@google/adk");
const { z } = require("zod/v4");

async function main() {
    const bookFlightTool = new FunctionTool({
        name: "adk_book_flight",
        description: "Books a flight between two airports.",
        parameters: z.object({
            from_airport: z.string(),
            to_airport: z.string(),
        }),
        execute: async ({ from_airport, to_airport }) => ({
            status: "success",
            message: `Flight booked from ${from_airport} to ${to_airport}.`,
        }),
    });

    const result = await bookFlightTool.runAsync({
        args: { from_airport: "SFO", to_airport: "BOM" },
        toolContext: {
            invocationContext: { agent: { name: "adk_flight_booking_agent" } },
        },
    });

    return result;
}

module.exports = { main };
