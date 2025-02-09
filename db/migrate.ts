import "dotenv/config";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { db } from ".";

(async () => {
    try {
        await migrate(db, { migrationsFolder: "src/db/migrations" });
    } catch(error) {
        console.error("Error during migration")
        process.exit(1)
    }
})();
