import { resolveCandidate } from "./src/lib/resolver/candidate-resolver.js";

async function run() {
  const result = await resolveCandidate("Matthew Saenz");
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
run().catch(console.error);
