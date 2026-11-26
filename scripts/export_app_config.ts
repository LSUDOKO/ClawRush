// Copy the public devnet addresses + IDL into the app (no keys, only public data).
import fs from "fs";
import path from "path";
import { ROOT, loadState, idl } from "./lib/common.ts";
const st = loadState();
const pub = {
  cabinetId: st.cabinetId, programId: st.programId, validator: st.validator, mints: st.mints, config: st.config,
  cabinet: st.cabinet, mystery: st.mystery, vault: st.vault, vaultAtas: st.vaultAtas, faucet: st.faucet,
  mysteryPermission: st.mysteryPermission, initCabinetSig: st.initCabinetSig, delegateCabinetSig: st.delegateCabinetSig, sealSig: st.sealSig,
};
const dir = path.join(ROOT, "app", "src", "lib");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "devnet.json"), JSON.stringify(pub, null, 2) + "\n");
fs.writeFileSync(path.join(dir, "idl.json"), JSON.stringify(idl, null, 2) + "\n");
console.log("wrote app/src/lib/devnet.json + idl.json");
