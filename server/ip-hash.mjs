import { createHash } from "node:crypto";

// O hash de IP precisa ser estavel entre sessoes, alertas e migracoes.
// Nenhum consumidor persiste o IP bruto.
export function hashIp(ip) {
  return createHash("sha256")
    .update(String(ip ?? "unknown"))
    .digest("hex");
}
