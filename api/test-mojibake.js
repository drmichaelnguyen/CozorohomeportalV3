import { repairMojibake } from "./src/text-encoding.js";

console.log("Original: M\u00C3 HD");
console.log("Repaired:", repairMojibake("M\u00C3 HD"));
console.log("Original alias map key check:", "M\u00C3 HD".replace(/\s+/g, " ").toLowerCase());
console.log("Repaired alias map key check:", repairMojibake("M\u00C3 HD").replace(/\s+/g, " ").toLowerCase());

const testValue = "M\u00C3 HD";
const repaired = Buffer.from(testValue, "latin1").toString("utf8").normalize("NFC");
console.log("Just repaired:", repaired);
