import "../src/load-env.js";
import { grantComplimentaryCozoroMemberUpgrade } from "../src/google-sheets.js";

const result = await grantComplimentaryCozoroMemberUpgrade({
  email: "binhphamvb@gmail.com",
  targetMember: "Diamond",
  operator: "dr.trongto@gmail.com",
  reason:
    "Nâng hạng Diamond miễn phí (owner) / Complimentary Diamond upgrade — fee waived"
});

console.log(JSON.stringify(result, null, 2));
