"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey, Transaction, TransactionInstruction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import CabinetCanvas, { type Anim, type View } from "./CabinetCanvas";
import Joystick from "./Joystick";
import ProofDrawer, { type ProofItem } from "./ProofDrawer";
import {
  type AppSigner, type Cabinet, type Profile, base, erPublic, erFor, send, sendBatch, ix, keypairSigner, decodeCabinet, decodeProfile,
  cabinetPda, playerPda, PROGRAM_ID, NO_TURN, PLAY_PRICE, tokenBalance, solBalance, fmtAmount, short,
} from "@/lib/chain";
import { sfx, isMuted, setMuted, buzz } from "@/lib/sound";
import { loadBurner, createBurner, loadSession, newSession } from "@/lib/burner";

const SESSION_SECS = 4 * 3600;
type Busy = null | string;

export default function Game() {
  const wallet = useWallet();
  const [burner, setBurner] = useState<Keypair | null>(null);
  const [useBurner, setUseBurner] = useState(false);
  const [cab, setCab] = useState<Cabinet | null>(null);
  const [cabErr, setCabErr] = useState<string | null>(null);
  const [l1, setL1] = useState<{ exists: boolean; delegated: boolean; profile: Profile | null }>({ exists: false, delegated: false, profile: null });
  const [erProfile, setErProfile] = useState<Profile | null>(null);
  const [usdc, setUsdc] = useState<bigint>(0n);
  const [sol, setSol] = useState<number | null>(null);
  const [view, setView] = useState<View>("front");
  const [claw, setClaw] = useState({ x: 120, z: 120 });
  const [anim, setAnim] = useState<Anim>({ phase: "idle", t0: 0 });
  const [busy, setBusy] = useState<Busy>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "win" | "slip" | "miss" | "info" } | null>(null);
  const [proof, setProof] = useState<ProofItem[]>([]);
  const [lat, setLat] = useState<number[]>([]);
  const [muted, setMute] = useState(false);
  const [credits, setCredits] = useState(5);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [onboard, setOnboard] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [myRound, setMyRound] = useState<number | null>(null);
  const vec = useRef({ x: 0, z: 0 });
  const seq = useRef(1);
  const inflight = useRef(0);
  const lastRoundSeen = useRef<number>(-1);

  useEffect(() => {
    setBurner(loadBurner());
    setMute(isMuted());
    setOnboard(localStorage.getItem("clawrush.onboarded") !== "1");
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (loadBurner() && localStorage.getItem("clawrush.useBurner") === "1") setUseBurner(true);
    const t = setInterval(() => setNow(Date.now() / 1000), 250);
    return () => clearInterval(t);
  }, []);

  // The active signer: a connected wallet, or the opt-in burner (never silently swapped).
  const signer: AppSigner | null = useMemo(() => {
    if (useBurner && burner) return keypairSigner(burner);
    if (wallet.publicKey && wallet.signTransaction && wallet.signAllTransactions && wallet.signMessage) {
      return {
        publicKey: wallet.publicKey,
        signTransaction: (t: Transaction) => wallet.signTransaction!(t),
        signAllTransactions: (t: Transaction[]) => wallet.signAllTransactions!(t),
        signMessage: (m: Uint8Array) => wallet.signMessage!(m),
      };
    }
    return null;
  }, [useBurner, burner, wallet]);
  const me = signer?.publicKey.toBase58() ?? null;
  const session = useMemo(() => (me ? loadSession(me) : null), [me, l1.delegated, erProfile?.sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const sessionOk = !!(session && erProfile && erProfile.sessionKey === session.kp.publicKey.toBase58() && session.expires > now + 30);

  const addProof = useCallback((p: ProofItem) => setProof((x) => [p, ...x].slice(0, 30)), []);

  // ───── Cabinet: websocket subscription on the TEE ER + 2 s poll fallback ─────
  useEffect(() => {
    let alive = true;
    const apply = (data: Buffer) => { try { setCab(decodeCabinet(data)); setCabErr(null); } catch (e) { setCabErr(String(e)); } };
    const poll = async () => {
      try { const a = await erPublic.getAccountInfo(cabinetPda); if (alive && a) apply(a.data); } catch (e) { if (alive) setCabErr(`Can't reach the MagicBlock ER: ${String(e).slice(0, 80)}`); }
    };
    void poll();
    const id = erPublic.onAccountChange(cabinetPda, (a) => apply(a.data), { commitment: "confirmed" });
    const t = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(t); void erPublic.removeAccountChangeListener(id); };
  }, []);

  // ───── Player state (L1 + ER) ─────
  const refresh = useCallback(async () => {
    if (!signer) return;
    const p = playerPda(signer.publicKey);
    const [a, bal, s] = await Promise.all([base.getAccountInfo(p), tokenBalance(0, signer.publicKey), solBalance(signer.publicKey)]);
    setUsdc(bal); setSol(s);
    if (!a) { setL1({ exists: false, delegated: false, profile: null }); setErProfile(null); return; }
    const delegated = !a.owner.equals(PROGRAM_ID);
    setL1({ exists: true, delegated, profile: delegated ? null : decodeProfile(a.data) });
    if (delegated) { const e = await erPublic.getAccountInfo(p); setErProfile(e ? decodeProfile(e.data) : null); } else setErProfile(null);
  }, [signer]);
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 3000); return () => clearInterval(t); }, [refresh]);

  const myTurn = !!(cab && me && cab.turnOwner === me);
  const turnLeft = cab && cab.turnOwner !== NO_TURN ? Math.max(0, cab.turnExpiresAt - now) : 0;
  const queuePos = cab && me ? cab.queue.indexOf(me) : -1;
  const canControl = myTurn && sessionOk && !cab!.pendingVrf && turnLeft > 0 && anim.phase === "idle";

  // Reconcile claw with chain when no moves are in flight.
  useEffect(() => { if (cab && inflight.current === 0 && anim.phase === "idle") setClaw({ x: cab.clawX, z: cab.clawZ }); }, [cab, anim.phase]);

  // ───── Result detection (VRF callback landed) ─────
  useEffect(() => {
    if (!cab) return;
    const L = cab.last;
    if (lastRoundSeen.current === -1) { lastRoundSeen.current = L.round; return; }
    if (L.round === lastRoundSeen.current || L.ts === 0) return;
    lastRoundSeen.current = L.round;
    const mine = L.player === me;
    const idx = cab.capsules.findIndex((c) => c.id === L.capsuleId);
    setClaw({ x: L.clawX, z: L.clawZ });
    setAnim({ phase: "lift", t0: performance.now(), outcome: L.outcome, capsuleIdx: idx >= 0 ? idx : undefined });
    setTimeout(() => setAnim({ phase: "idle", t0: performance.now() }), 1300);
    if (L.outcome === 1) { if (mine) sfx.win(); else sfx.clink(); }
    else if (L.outcome === 2) sfx.slip(); else sfx.miss();
    const who = mine ? "You" : short(L.player);
    const text = L.outcome === 1
      ? `${who} won ${fmtAmount(L.mintIdx, L.amount)}${L.kind === 2 ? ` · mystery revealed (${["", "dust", "mid", "jackpot"][L.tier]})` : ""}`
      : L.outcome === 2 ? `${who}: SLIP — capsule slid toward the chute` : `${who}: MISS`;
    setToast({ text, tone: L.outcome === 1 ? "win" : L.outcome === 2 ? "slip" : "miss" });
    setTimeout(() => setToast(null), 4500);
    if (mine) setMyRound(null);
  }, [cab, me]);

  // Turn start chime
  const wasMyTurn = useRef(false);
  useEffect(() => { if (myTurn && !wasMyTurn.current) { sfx.turn(); buzz(40); } wasMyTurn.current = myTurn; }, [myTurn]);

  // ───── Joystick → throttled move_claw (fire-and-forget, client-side prediction) ─────
  useEffect(() => {
    if (!canControl || !session || !me) return;
    const owner = new PublicKey(me);
    const ss = keypairSigner(session.kp);
    let er: Awaited<ReturnType<typeof erFor>> | null = null;
    const t = setInterval(async () => {
      const v = vec.current;
      if (Math.hypot(v.x, v.z) < 0.15 || inflight.current > 6) return;
      const dx = Math.round(v.x * 80), dz = Math.round(v.z * 80);
      setClaw((c) => ({ x: Math.max(0, Math.min(1000, c.x + dx)), z: Math.max(0, Math.min(1000, c.z + dz)) }));
      sfx.whirr();
      inflight.current++;
      try {
        er ??= await erFor(ss);
        const r = await send(er, [await ix.moveClaw(ss.publicKey, owner, dx, dz, seq.current++)], ss);
        setLat((l) => [...l.slice(-19), r.ms]);
      } catch (e) { setErr(`Move failed: ${String(e).slice(0, 120)}`); }
      finally { inflight.current--; }
    }, 120);
    return () => clearInterval(t);
  }, [canControl, session, me]);

  // ───── Clear stale turns (permissionless expire_turn), including my own timed-out turn or a stuck VRF ─────
  const expiring = useRef<number>(-1);
  useEffect(() => {
    if (!cab || !session || cab.turnOwner === NO_TURN || expiring.current === cab.round) return;
    const stale = cab.pendingVrf ? now > cab.dropAt + 31 : now > cab.turnExpiresAt + 1;
    if (!stale) return;
    expiring.current = cab.round;
    const ss = keypairSigner(session.kp);
    void (async () => {
      try {
        const r = await send(await erFor(ss), [await ix.expireTurn(ss.publicKey, new PublicKey(cab.turnOwner))], ss);
        addProof({ label: cab.turnOwner === me ? "expire_turn (your turn timed out)" : "expire_turn (stale turn)", sig: r.sig, er: true });
        if (cab.turnOwner === me) { setAnim({ phase: "idle", t0: performance.now() }); setMyRound(null); }
      } catch { /* someone else cleared it; retry next round if still stuck */ expiring.current = -1; }
      void refresh();
    })();
  }, [cab, session, now, me]);

  // ───── Actions ─────
  const run = async (label: string, f: () => Promise<void>) => {
    setBusy(label); setErr(null);
    try { await f(); } catch (e) { setErr(String((e as Error)?.message ?? e).slice(0, 220)); }
    finally { setBusy(null); void refresh(); }
  };

  const startSession = () => run("Starting session…", async () => {
    if (!signer || !me) return;
    const w = signer.publicKey;
    const need = PLAY_PRICE * BigInt(credits);
    const ixs: TransactionInstruction[] = [];
    // Read fresh chain state: the polled state may not have loaded yet when the button is pressed.
    const [prof, bal] = await Promise.all([base.getAccountInfo(playerPda(w)), tokenBalance(0, w)]);
    if (!prof) ixs.push(await ix.initPlayer(w));
    if (bal < need) ixs.push(await ix.faucet(w)); // demo faucet, rate-limited on chain (1 per hour)
    const s = newSession(me, SESSION_SECS);
    if (credits > 0) ixs.push(await ix.buyCredits(w, credits));
    ixs.push(await ix.registerSession(w, s.kp.publicKey, s.expires));
    ixs.push(await ix.delegatePlayer(w));
    const r = await send(base, ixs, signer, 400_000);
    addProof({ label: "Session start: buy credits + session key + delegate (L1)", sig: r.sig });
    sfx.coin();
    for (let i = 0; i < 20; i++) { if (await erPublic.getAccountInfo(playerPda(w))) break; await new Promise((ok) => setTimeout(ok, 1000)); }
  });

  const join = () => run("Joining queue…", async () => {
    if (!session || !me) return;
    const ss = keypairSigner(session.kp);
    const r = await send(await erFor(ss), [await ix.joinQueue(ss.publicKey, new PublicKey(me))], ss);
    addProof({ label: "join_queue (session key, ER)", sig: r.sig, er: true });
    sfx.coin();
  });

  const drop = () => run("Dropping…", async () => {
    if (!session || !me || !cab) return;
    const ss = keypairSigner(session.kp);
    for (let i = 0; i < 30 && inflight.current > 0; i++) await new Promise((ok) => setTimeout(ok, 100));
    setAnim({ phase: "drop", t0: performance.now() });
    sfx.servo();
    setMyRound(cab.round);
    let r;
    try { r = await send(await erFor(ss), [await ix.dropClaw(ss.publicKey, new PublicKey(me), Math.floor(Math.random() * 256))], ss, 400_000); }
    catch (e) { setAnim({ phase: "idle", t0: performance.now() }); setMyRound(null); throw e; }
    addProof({ label: "drop_claw → VRF request (ER)", sig: r.sig, er: true });
    // On a slow link the VRF result can land before this confirmation; don't overwrite the result animation.
    setAnim((a) => (a.phase === "drop" ? { phase: "hold", t0: performance.now() } : a));
    sfx.drumroll();
  });

  const cashOut = () => run("Cashing out…", async () => {
    if (!signer) return;
    const w = signer.publicKey;
    const er = await erFor(signer); // wallet signs one login message for the TEE
    const r = await send(er, [await ix.cashOut(w)], signer);
    addProof({ label: "cash_out: commit + undelegate profile (ER)", sig: r.sig, er: true });
    let back = false;
    for (let i = 0; i < 40 && !back; i++) { const a = await base.getAccountInfo(playerPda(w)); back = !!a && a.owner.equals(PROGRAM_ID); if (!back) await new Promise((ok) => setTimeout(ok, 1000)); }
    if (!back) throw new Error("Profile not back on Solana yet — try Claim again in a few seconds.");
    await claim();
  });

  const claim = async () => {
    if (!signer) return;
    const w = signer.publicKey;
    const a = await base.getAccountInfo(playerPda(w));
    if (!a) return;
    const p = decodeProfile(a.data);
    const groups: TransactionInstruction[][] = [];
    const won: string[] = [];
    for (let i = 0; i < 4; i++) if (p.pending[i] > 0n) { groups.push([await ix.claimPrize(w, i)]); won.push(fmtAmount(i, p.pending[i])); }
    if (!groups.length) { setToast({ text: "Cashed out. No prizes pending.", tone: "info" }); return; }
    const sigs = await sendBatch(base, groups, signer);
    sigs.forEach((s, i) => addProof({ label: `claim_prize ${won[i]} → your wallet (L1)`, sig: s.sig }));
    sfx.win();
    setToast({ text: `Paid to your wallet: ${won.join(", ")}`, tone: "win" });
  };

  const airdrop = () => run("Requesting devnet SOL…", async () => {
    if (!burner) return;
    const sig = await base.requestAirdrop(burner.publicKey, LAMPORTS_PER_SOL);
    await base.confirmTransaction(sig, "confirmed");
  });

  const pickBurner = () => { const b = burner ?? createBurner(); setBurner(b); setUseBurner(true); localStorage.setItem("clawrush.useBurner", "1"); };
  const leaveBurner = () => { setUseBurner(false); localStorage.setItem("clawrush.useBurner", "0"); };

  // ───── UI ─────
  const avgLat = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null;
  const activeCaps = cab?.capsules.filter((c) => c.active).length ?? 0;
  const playersNow = cab ? cab.queue.length + (cab.turnOwner !== NO_TURN ? 1 : 0) : 0;
  const latestWin = cab?.recentWins[0];
  const credLeft = erProfile?.credits ?? l1.profile?.credits ?? 0;
  const pendingPrizes = (erProfile ?? l1.profile)?.pending.map((v, i) => (v > 0n ? fmtAmount(i, v) : null)).filter(Boolean) ?? [];

  let stage: "connect" | "fund" | "start" | "resume" | "play" = "connect";
  if (signer) {
    if (useBurner && sol !== null && sol < 0.03) stage = "fund";
    else if (!l1.delegated) stage = "start";
    else if (!sessionOk) stage = "resume";
    else stage = "play";
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-2 px-3 pb-4 pt-2 text-white">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl leading-none tracking-wider text-pink-400 drop-shadow-[0_0_10px_rgba(255,61,189,0.9)]">CLAWRUSH</h1>
          <p className="text-[10px] tracking-[0.3em] text-cyan-300/80">クローラッシュ · DEVNET</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full border border-white/15 px-2 py-1" title="Players on this cabinet right now (from chain)">{playersNow} in play</span>
          <button className="h-11 w-11 rounded-full border border-white/15 text-lg" aria-label={muted ? "Unmute" : "Mute"} onClick={() => { setMuted(!muted); setMute(!muted); }}>{muted ? "🔇" : "🔊"}</button>
        </div>
      </header>
      <div className="h-6 overflow-hidden rounded bg-white/5 px-2 text-xs leading-6 text-yellow-200" aria-live="polite">
        {latestWin ? `🏆 ${short(latestWin.player)} won ${fmtAmount(latestWin.mintIdx, latestWin.amount)} · ${ago(now - latestWin.ts)}` : "No wins yet on this cabinet — be first."}
      </div>

      {/* Cabinet */}
      <section className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl border-2 border-pink-500/70 shadow-[0_0_30px_rgba(255,61,189,0.35)]">
        {cab ? <CabinetCanvas cabinet={cab} claw={claw} view={view} anim={anim} reduced={reduced} /> : (
          <div className="flex h-full items-center justify-center text-sm text-white/60">{cabErr ?? "Connecting to the cabinet on MagicBlock ER…"}</div>
        )}
        {toast && (
          <div role="status" className={`absolute inset-x-3 top-12 rounded-xl px-3 py-2 text-center text-sm font-bold backdrop-blur ${toast.tone === "win" ? "bg-yellow-400/90 text-black" : toast.tone === "slip" ? "bg-fuchsia-600/90" : toast.tone === "miss" ? "bg-slate-700/90" : "bg-cyan-700/90"}`}>
            {toast.text}
          </div>
        )}
        {cab?.pendingVrf && <div className="absolute inset-x-0 bottom-10 text-center text-sm font-bold text-cyan-200 animate-pulse">Rolling MagicBlock VRF…</div>}
        <div className="absolute right-2 top-2 flex flex-col items-end gap-1 text-[11px]">
          <span className="rounded bg-black/50 px-2 py-0.5">{activeCaps} capsules</span>
        </div>
      </section>

      {/* View + timer */}
      <div className="flex items-center justify-between">
        <div className="flex overflow-hidden rounded-full border border-cyan-300/40" role="group" aria-label="Camera view">
          {(["front", "side"] as View[]).map((v) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={`h-11 px-5 text-sm font-bold uppercase ${view === v ? "bg-cyan-300 text-black" : "text-cyan-200"}`}>{v}</button>
          ))}
        </div>
        <TimerRing left={turnLeft} total={15} label={cab?.turnOwner === NO_TURN ? "idle" : myTurn ? "your turn" : short(cab?.turnOwner ?? "")} />
      </div>

      {/* Controls */}
      {stage === "play" ? (
        <div className="flex items-center justify-between gap-3">
          <Joystick vec={vec} disabled={!canControl} />
          <div className="flex flex-1 flex-col items-stretch gap-2">
            {myTurn ? (
              <button onClick={drop} disabled={!canControl || !!busy} className="h-24 rounded-2xl bg-gradient-to-b from-yellow-300 to-orange-500 text-3xl font-black text-black shadow-[0_0_30px_rgba(255,180,0,0.6)] disabled:opacity-40">DROP</button>
            ) : queuePos >= 0 ? (
              <div className="rounded-2xl border border-white/15 p-3 text-center text-sm">{queuePos >= 0 ? `You're #${queuePos + 1} in queue` : myRound !== null ? "Waiting for VRF…" : "In queue…"}</div>
            ) : (
              <button onClick={join} disabled={!!busy || credLeft === 0} className="h-24 rounded-2xl bg-gradient-to-b from-pink-400 to-fuchsia-700 text-xl font-black shadow-[0_0_24px_rgba(255,61,189,0.6)] disabled:opacity-40">
                {credLeft === 0 ? "No credits" : "INSERT CREDIT"}
              </button>
            )}
            <p className="text-center text-xs text-white/70">{credLeft} credits{pendingPrizes.length ? ` · won: ${pendingPrizes.join(", ")}` : ""}</p>
          </div>
        </div>
      ) : (
        <Onramp stage={stage} wallet={wallet} useBurner={useBurner} burner={burner} sol={sol} usdc={usdc} credits={credits} setCredits={setCredits}
          busy={busy} pickBurner={pickBurner} leaveBurner={leaveBurner} airdrop={airdrop} start={startSession} cashOut={cashOut} />
      )}
      {stage === "play" && queuePos < 0 && !myTurn && (
        <button onClick={cashOut} disabled={!!busy} className="h-11 rounded-xl border border-yellow-300/60 text-sm font-bold text-yellow-200 disabled:opacity-40">
          Cash out & claim prizes to wallet
        </button>
      )}
      {busy && <p className="text-center text-sm text-cyan-200" role="status">{busy}</p>}
      {err && <p className="rounded-lg bg-red-900/60 p-2 text-xs text-red-100" role="alert">{err}</p>}

      <ProofDrawer cab={cab} proof={proof} avgLat={avgLat} lastLat={lat[lat.length - 1] ?? null} me={me} session={session?.kp.publicKey.toBase58() ?? null} />

      {signer && (
        <p className="text-center text-[11px] text-white/50">
          {useBurner ? "⚠ DEVNET BURNER " : "Wallet "}{short(me!)} · {sol?.toFixed(3) ?? "…"} SOL · {(Number(usdc) / 1e6).toFixed(2)} dUSDC
          {useBurner ? <> · <button className="underline" onClick={leaveBurner}>switch to real wallet</button></> : wallet.connected ? <> · <button className="underline" onClick={() => void wallet.disconnect()}>disconnect</button></> : null}
        </p>
      )}

      {onboard && <Onboarding done={() => { setOnboard(false); localStorage.setItem("clawrush.onboarded", "1"); }} />}
    </main>
  );
}

function ago(s: number) {
  if (s < 60) return `${Math.max(0, Math.round(s))}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function TimerRing({ left, total, label }: { left: number; total: number; label: string }) {
  const f = Math.max(0, Math.min(1, left / total));
  const C = 2 * Math.PI * 18;
  return (
    <div className="flex items-center gap-2" aria-label={`Turn timer ${Math.ceil(left)} seconds, ${label}`}>
      <span className="text-xs text-white/70">{label}</span>
      <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden>
        <circle cx="24" cy="24" r="18" stroke="rgba(255,255,255,0.15)" strokeWidth="5" fill="none" />
        <circle cx="24" cy="24" r="18" stroke={f < 0.3 ? "#ff3d5a" : "#3df5ff"} strokeWidth="5" fill="none" strokeDasharray={C} strokeDashoffset={C * (1 - f)} transform="rotate(-90 24 24)" strokeLinecap="round" />
        <text x="24" y="29" textAnchor="middle" fontSize="14" fill="#fff" fontWeight="bold">{Math.ceil(left)}</text>
      </svg>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Onramp(p: any) {
  const { stage, wallet, useBurner, burner, sol, usdc, credits, setCredits, busy, pickBurner, airdrop, start, cashOut } = p;
  if (stage === "connect") {
    const ws = wallet.wallets.filter((w: { readyState: string }) => w.readyState === "Installed" || w.readyState === "Loadable");
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-white/15 p-3">
        <p className="text-sm text-white/80">Connect a Solana wallet on <b>devnet</b> to play.</p>
        {ws.length ? ws.map((w: { adapter: { name: string; icon: string } }) => (
          <button key={w.adapter.name} onClick={() => { wallet.select(w.adapter.name); void wallet.connect().catch(() => {}); }}
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-white text-sm font-bold text-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={w.adapter.icon} alt="" className="h-5 w-5" /> {w.adapter.name}
          </button>
        )) : <p className="text-xs text-white/60">No wallet detected. Install Phantom or Solflare (set to devnet), or open this page in your wallet&apos;s browser.</p>}
        <button onClick={pickBurner} className="h-11 rounded-xl border border-orange-400/60 text-sm text-orange-200">
          {burner ? "Use my devnet burner wallet" : "Try with a devnet burner wallet (testing only)"}
        </button>
        <p className="text-[11px] text-white/50">The burner is a throwaway devnet key kept in this browser only. Devnet tokens have no value.</p>
      </div>
    );
  }
  if (stage === "fund") return (
    <div className="flex flex-col gap-2 rounded-2xl border border-orange-400/50 p-3 text-sm">
      <p><b>⚠ Devnet burner</b> {useBurner && burner ? short(burner.publicKey.toBase58()) : ""} needs a little devnet SOL for fees (has {sol?.toFixed(3)}).</p>
      <button onClick={airdrop} disabled={!!busy} className="h-11 rounded-xl bg-orange-400 font-bold text-black disabled:opacity-40">Airdrop 1 devnet SOL</button>
      <a className="text-center text-xs underline" href="https://faucet.solana.com" target="_blank" rel="noreferrer">Airdrop rate-limited? Use faucet.solana.com with the address above</a>
    </div>
  );
  if (stage === "start") return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/15 p-3 text-sm">
      <p>Buy credits (1 dUSDC each) and open a play session. One approval: it registers a <b>session key</b> that can only move, drop and queue — never withdraw.</p>
      <div className="flex items-center justify-between">
        <span>Credits</span>
        <div className="flex items-center gap-2">
          <button aria-label="Fewer credits" className="h-11 w-11 rounded-full border border-white/20" onClick={() => setCredits(Math.max(1, credits - 1))}>−</button>
          <span className="w-6 text-center font-bold">{credits}</span>
          <button aria-label="More credits" className="h-11 w-11 rounded-full border border-white/20" onClick={() => setCredits(Math.min(20, credits + 1))}>+</button>
        </div>
      </div>
      <p className="text-xs text-white/60">{usdc >= BigInt(credits) * 1_000_000n ? `You have ${(Number(usdc) / 1e6).toFixed(2)} dUSDC.` : "You'll get 20 free demo dUSDC from the devnet faucet in the same transaction."}</p>
      <button onClick={start} disabled={!!busy} className="h-12 rounded-xl bg-gradient-to-b from-pink-400 to-fuchsia-700 font-black disabled:opacity-40">START SESSION</button>
    </div>
  );
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/15 p-3 text-sm">
      <p>Your profile is still on the ER from an earlier session, but this browser has no valid session key. Cash out to settle any prizes, then start a new session.</p>
      <button onClick={cashOut} disabled={!!busy} className="h-12 rounded-xl bg-yellow-400 font-bold text-black disabled:opacity-40">Cash out & claim</button>
    </div>
  );
}

function Onboarding({ done }: { done: () => void }) {
  const steps = [
    ["One claw, every player", "This cabinet is shared live on a MagicBlock Ephemeral Rollup. Capsules stay where they land for the next player."],
    ["Aim in 3D", "FRONT view shows left/right, SIDE view shows depth. Switch views to line the claw up — then DROP."],
    ["Skill × VRF", "Your aim sets the grip chance (85% dead centre → 25% at the edge). MagicBlock VRF rolls it. HELD prizes pay out to your wallet."],
  ];
  const [i, setI] = useState(0);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4" role="dialog" aria-modal aria-label="How to play">
      <div className="w-full max-w-md rounded-2xl border border-pink-400/60 bg-[#14062a] p-5">
        <p className="text-xs text-cyan-300">{i + 1} / 3</p>
        <h2 className="mt-1 text-xl font-black text-pink-300">{steps[i][0]}</h2>
        <p className="mt-2 text-sm text-white/85">{steps[i][1]}</p>
        <div className="mt-4 flex justify-between">
          <button className="h-11 px-3 text-sm text-white/60" onClick={done}>Skip</button>
          <button className="h-11 rounded-xl bg-pink-500 px-6 font-bold" onClick={() => (i < 2 ? setI(i + 1) : done())}>{i < 2 ? "Next" : "Play"}</button>
        </div>
      </div>
    </div>
  );
}

