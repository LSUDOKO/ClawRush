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
  const [toast, setToast] = useState<{ text: string; tone: "win" | "slip" | "miss" | "info"; mine?: boolean; mystery?: boolean } | null>(null);
  const [entered, setEntered] = useState(false);
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
    setToast({ text, tone: L.outcome === 1 ? "win" : L.outcome === 2 ? "slip" : "miss", mine, mystery: L.kind === 2 });
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

  const muteBtn = (
    <button className="btn3d btn-violet h-11 w-11 shrink-0 text-lg" aria-label={muted ? "Unmute" : "Mute"} onClick={() => { setMuted(!muted); setMute(!muted); }}>
      <span aria-hidden>{muted ? "🔇" : "🔊"}</span>
    </button>
  );
  const ticker = (
    <div className="slime-bar mx-1 flex h-8 items-center gap-2 overflow-hidden px-2 text-xs font-extrabold" aria-live="polite">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/art/trophy.webp" alt="" className="h-6 w-auto" />
      <span className="truncate">{latestWin ? `${short(latestWin.player)} won ${fmtAmount(latestWin.mintIdx, latestWin.amount)}${latestWin.kind === 2 ? " from a mystery capsule" : ""} · ${ago(now - latestWin.ts)}` : "No wins yet on this cabinet. Be the first!"}</span>
    </div>
  );

  // ───── Title screen ─────
  if (!entered) return (
    <main className="scene relative mx-auto flex min-h-dvh max-w-md flex-col items-center overflow-hidden px-4 pb-6 pt-3 text-white">
      <div className="flex w-full items-center justify-between">
        <span className="pill text-xs"><span className="ml-1 h-2.5 w-2.5 rounded-full bg-[var(--lime)] shadow-[0_0_8px_#a6ff2e]" /> SOLANA DEVNET</span>
        {muteBtn}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/art/logo.webp" alt="ClawRush" className="float-slow mt-1 w-[74%] drop-shadow-[0_10px_18px_rgba(0,0,0,0.6)]" />
      <p className="title-stroke font-display -mt-1 text-center text-lg">One claw · every player · real prizes</p>

      <div className="relative mt-1 h-56 w-full">
        <div className="rays absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 opacity-70" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/crew_slime.webp" alt="" className="float absolute bottom-2 left-0 w-[30%] drop-shadow-[0_8px_10px_rgba(0,0,0,0.6)]" style={{ animationDelay: "0.4s" }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/mascot_base.webp" alt="Grabbo, the ClawRush monster" className="wobble absolute bottom-0 left-1/2 w-[52%] -translate-x-1/2 drop-shadow-[0_12px_14px_rgba(0,0,0,0.7)]" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/crew_bat.webp" alt="" className="float absolute right-0 top-4 w-[32%] drop-shadow-[0_8px_10px_rgba(0,0,0,0.6)]" style={{ animationDelay: "1.1s" }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/cap_mystery.webp" alt="" className="float-slow absolute left-[6%] top-2 w-[17%]" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/cap_gold.webp" alt="" className="float absolute bottom-0 right-[4%] w-[18%]" style={{ animationDelay: "0.8s" }} />
      </div>

      <div className="panel mt-3 grid w-full grid-cols-3 gap-1 px-2 py-2 text-center">
        {[
          [cab ? String(activeCaps) : "…", "capsules"],
          [cab ? String(cab.plays) : "…", "plays"],
          [cab ? String(cab.wins) : "…", "prizes won"],
        ].map(([v, l]) => (
          <div key={l}><p className="title-stroke font-display text-2xl leading-none">{v}</p><p className="text-[11px] font-bold uppercase text-white/75">{l}</p></div>
        ))}
      </div>
      <div className="mt-3 w-full">{ticker}</div>

      <button onClick={() => { setEntered(true); sfx.coin(); }} className="btn3d btn-gold pulse-glow mt-5 h-16 w-[80%] text-3xl">PLAY NOW</button>
      <button onClick={() => { setEntered(true); setOnboard(true); }} className="btn3d btn-violet mt-3 h-11 px-6 text-base">HOW IT WORKS</button>
      <p className="mt-auto pt-5 text-center text-[11px] font-semibold text-white/60">Live on MagicBlock Ephemeral Rollups · VRF · Private ER · Solana devnet (test tokens, no real value)</p>
    </main>
  );

  // ───── Game screen ─────
  const bulbs = Array.from({ length: 22 }, (_, i) => {
    const side = i < 6 ? "t" : i < 11 ? "r" : i < 17 ? "b" : "l";
    const k = i < 6 ? i : i < 11 ? i - 6 : i < 17 ? i - 11 : i - 17;
    const n = side === "t" || side === "b" ? 6 : 5;
    const f = `${((k + 0.5) / n) * 100}%`;
    const pos = side === "t" ? { top: 1, left: f } : side === "b" ? { bottom: 1, left: f } : side === "r" ? { right: 1, top: f } : { left: 1, top: f };
    return <i key={i} style={pos} />;
  });
  return (
    <main className="scene mx-auto flex min-h-dvh max-w-md flex-col gap-2.5 px-3 pb-5 pt-2 text-white">
      {/* HUD */}
      <header className="flex items-center justify-between gap-2">
        <button onClick={() => setEntered(false)} aria-label="Back to title screen" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/art/logo.webp" alt="ClawRush" className="h-12 w-auto drop-shadow-[0_4px_6px_rgba(0,0,0,0.6)]" />
        </button>
        <div className="flex items-center gap-1.5">
          <span className="pill text-sm" title="Your play credits">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/art/token.webp" alt="" className="h-6 w-6" />{signer ? credLeft : "–"}
          </span>
          <span className="pill text-sm" title="Players on this cabinet right now (from chain)">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/art/mascot_base.webp" alt="" className="h-6 w-6 object-contain" />{playersNow}
          </span>
          {muteBtn}
        </div>
      </header>
      {ticker}

      {/* Cabinet */}
      <div className="cabinet relative mt-1">
        <div className="bulbs" aria-hidden>{bulbs}</div>
        <section className="cabinet-inner relative aspect-[4/5] w-full overflow-hidden bg-[#14041f]">
          {cab ? <CabinetCanvas cabinet={cab} claw={claw} view={view} anim={anim} reduced={reduced} /> : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm font-bold text-white/80">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/art/mascot_base.webp" alt="" className="wobble w-28" />
              {cabErr ?? "Connecting to the live cabinet on MagicBlock ER…"}
            </div>
          )}
          {toast && !(toast.mine && toast.tone !== "info") && (
            <div role="status" className={`pop-in absolute inset-x-3 top-12 rounded-2xl border-[3px] border-[var(--ink)] px-3 py-2 text-center text-sm font-extrabold shadow-lg ${toast.tone === "win" ? "bg-[var(--gold)] text-[var(--ink)]" : toast.tone === "slip" ? "bg-[var(--magenta)]" : toast.tone === "miss" ? "bg-[#3b1d5e]" : "bg-[var(--violet)]"}`}>
              {toast.text}
            </div>
          )}
          {cab?.pendingVrf && (
            <div className="absolute inset-x-0 bottom-9 flex justify-center">
              <span className="pill animate-pulse text-sm text-[var(--lime)]">🎲 Rolling MagicBlock VRF…</span>
            </div>
          )}
          <div className="absolute right-2 top-3 flex flex-col items-end gap-1">
            <span className="pill text-xs">{activeCaps} capsules</span>
          </div>
        </section>
      </div>

      {/* View + timer */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2" role="group" aria-label="Camera view">
          {(["front", "side"] as View[]).map((v) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
              className={`btn3d h-11 px-4 text-base uppercase ${view === v ? "btn-gold" : "btn-violet"}`}>{v}</button>
          ))}
        </div>
        <TimerRing left={turnLeft} total={15} label={cab?.turnOwner === NO_TURN ? "Cabinet idle" : myTurn ? "YOUR TURN!" : `${short(cab?.turnOwner ?? "")} playing`} />
      </div>

      {/* Controls */}
      {stage === "play" ? (
        <div className="panel flex items-center justify-between gap-4 px-5 py-5">
          <Joystick vec={vec} disabled={!canControl} />
          <div className="flex flex-1 flex-col items-center gap-3">
            {myTurn ? (
              <button onClick={drop} disabled={!canControl || !!busy} className="btn3d btn-drop h-28 w-28 text-3xl">DROP</button>
            ) : queuePos >= 0 ? (
              <div className="flex flex-col items-center text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/art/crew_bat.webp" alt="" className="float w-20" />
                <p className="title-stroke font-display text-xl">You&apos;re #{queuePos + 1}</p>
                <p className="text-xs font-bold text-white/75">in the queue. Get ready!</p>
              </div>
            ) : (
              <button onClick={join} disabled={!!busy || credLeft === 0} className="btn3d btn-pink h-24 w-full flex-col gap-0 text-xl leading-tight">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/art/token.webp" alt="" className="h-8 w-8" />
                {credLeft === 0 ? "No credits" : "INSERT CREDIT"}
              </button>
            )}
            <p className="text-center text-xs font-bold text-white/80">{credLeft} credits{pendingPrizes.length ? ` · won: ${pendingPrizes.join(", ")}` : ""}{myRound !== null && !myTurn ? " · waiting for VRF…" : ""}</p>
          </div>
        </div>
      ) : (
        <Onramp stage={stage} wallet={wallet} useBurner={useBurner} burner={burner} sol={sol} usdc={usdc} credits={credits} setCredits={setCredits}
          busy={busy} pickBurner={pickBurner} leaveBurner={leaveBurner} airdrop={airdrop} start={startSession} cashOut={cashOut} />
      )}
      {stage === "play" && queuePos < 0 && !myTurn && (
        <button onClick={cashOut} disabled={!!busy} className="btn3d btn-gold h-12 text-base">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/art/trophy.webp" alt="" className="h-7 w-auto" /> Cash out &amp; claim prizes
        </button>
      )}
      {busy && <p className="pill mx-auto text-sm text-[var(--cyan)]" role="status">{busy}</p>}
      {err && <p className="rounded-2xl border-2 border-[var(--ink)] bg-[#7a0d2c] p-2 text-xs font-bold text-red-50" role="alert">{err}</p>}

      <ProofDrawer cab={cab} proof={proof} avgLat={avgLat} lastLat={lat[lat.length - 1] ?? null} me={me} session={session?.kp.publicKey.toBase58() ?? null} />

      {signer && (
        <p className="text-center text-[11px] font-semibold text-white/60">
          {useBurner ? "⚠ DEVNET BURNER " : "Wallet "}{short(me!)} · {sol?.toFixed(3) ?? "…"} SOL · {(Number(usdc) / 1e6).toFixed(2)} dUSDC
          {useBurner ? <> · <button className="underline" onClick={leaveBurner}>switch to real wallet</button></> : wallet.connected ? <> · <button className="underline" onClick={() => void wallet.disconnect()}>disconnect</button></> : null}
        </p>
      )}

      {/* My result: full-screen celebration (non-blocking, auto-dismisses) */}
      {toast?.mine && toast.tone !== "info" && <ResultSplash tone={toast.tone} text={toast.text} mystery={!!toast.mystery} reduced={reduced} />}

      {onboard && <Onboarding done={() => { setOnboard(false); localStorage.setItem("clawrush.onboarded", "1"); }} />}
    </main>
  );
}

function ago(s: number) {
  if (s < 60) return `${Math.max(0, Math.round(s))}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function ResultSplash({ tone, text, mystery, reduced }: { tone: string; text: string; mystery: boolean; reduced: boolean }) {
  const win = tone === "win";
  const head = win ? (mystery ? "MYSTERY REVEALED!" : "YOU WON!") : tone === "slip" ? "SO CLOSE!" : "MISSED!";
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-[rgba(18,4,31,0.55)] p-6">
      {win && !reduced && <div className="coin-rain absolute inset-0 overflow-hidden" aria-hidden>{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ left: `${(i * 7.3) % 100}%`, animationDelay: `${(i % 7) * 0.22}s` }} />)}</div>}
      <div className="pop-in relative flex w-full max-w-sm flex-col items-center">
        {win && <div className="rays absolute left-1/2 top-24 h-80 w-80 -translate-x-1/2 -translate-y-1/2" aria-hidden />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={win ? "/art/mascot_win.webp" : "/art/mascot_sad.webp"} alt="" className="relative w-56 drop-shadow-[0_12px_16px_rgba(0,0,0,0.7)]" />
        <p className={`font-display relative -mt-2 text-5xl ${win ? "title-stroke" : "text-outline text-[var(--magenta)]"}`}>{head}</p>
        <div role="status" className={`panel relative mt-3 px-4 py-3 text-center text-base font-extrabold ${win ? "text-[var(--gold)]" : ""}`}>{text}</div>
      </div>
    </div>
  );
}

function TimerRing({ left, total, label }: { left: number; total: number; label: string }) {
  const f = Math.max(0, Math.min(1, left / total));
  const C = 2 * Math.PI * 22;
  const low = f < 0.3 && left > 0;
  return (
    <div className="flex items-center gap-2" aria-label={`Turn timer ${Math.ceil(left)} seconds, ${label}`}>
      <span className={`text-right text-xs font-extrabold leading-tight ${label === "YOUR TURN!" ? "title-stroke font-display text-base" : "text-white/80"}`}>{label}</span>
      <svg width="60" height="60" viewBox="0 0 60 60" aria-hidden className={low ? "animate-pulse" : ""}>
        <circle cx="30" cy="30" r="28" fill="#1a0630" />
        <circle cx="30" cy="30" r="25" fill="url(#coin)" stroke="#1a0630" strokeWidth="2" />
        <defs><radialGradient id="coin" cx="40%" cy="30%"><stop offset="0" stopColor="#4a167a" /><stop offset="1" stopColor="#1d0636" /></radialGradient></defs>
        <circle cx="30" cy="30" r="22" stroke="rgba(255,255,255,0.12)" strokeWidth="5" fill="none" />
        <circle cx="30" cy="30" r="22" stroke={low ? "#ff1f4b" : "#ffcf3a"} strokeWidth="5" fill="none" strokeDasharray={C} strokeDashoffset={C * (1 - f)} transform="rotate(-90 30 30)" strokeLinecap="round" />
        <text x="30" y="37" textAnchor="middle" fontSize="20" fill="#fff" stroke="#1a0630" strokeWidth="3" paintOrder="stroke" fontFamily="var(--font-display)">{Math.ceil(left)}</text>
      </svg>
    </div>
  );
}

function PanelHead({ img, title }: { img: string; title: string }) {
  return (
    <div className="-mt-12 mb-1 flex flex-col items-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={img} alt="" className="float h-24 w-auto drop-shadow-[0_8px_10px_rgba(0,0,0,0.6)]" />
      <h2 className="title-stroke font-display text-2xl">{title}</h2>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Onramp(p: any) {
  const { stage, wallet, useBurner, burner, sol, usdc, credits, setCredits, busy, pickBurner, airdrop, start, cashOut } = p;
  if (stage === "connect") {
    const ws = wallet.wallets.filter((w: { readyState: string }) => w.readyState === "Installed" || w.readyState === "Loadable");
    return (
      <div className="panel mt-12 flex flex-col gap-3 px-4 pb-4">
        <PanelHead img="/art/mascot_base.webp" title="CONNECT TO PLAY" />
        <p className="text-center text-sm font-semibold text-white/85">Connect a Solana wallet set to <b className="text-[var(--lime)]">devnet</b>.</p>
        {ws.length ? ws.map((w: { adapter: { name: string; icon: string } }) => (
          <button key={w.adapter.name} onClick={() => { wallet.select(w.adapter.name); void wallet.connect().catch(() => {}); }}
            className="btn3d btn-violet h-12 text-base">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={w.adapter.icon} alt="" className="h-6 w-6 rounded" /> {w.adapter.name}
          </button>
        )) : <p className="text-center text-xs text-white/70">No wallet detected. Install Phantom or Solflare (set to devnet), or open this page in your wallet&apos;s browser.</p>}
        <button onClick={pickBurner} className="btn3d btn-lime h-12 text-base">
          {burner ? "Use my devnet burner" : "Try a devnet burner wallet"}
        </button>
        <p className="text-center text-[11px] text-white/60">The burner is a throwaway devnet key kept in this browser only. Testing only; devnet tokens have no value.</p>
      </div>
    );
  }
  if (stage === "fund") return (
    <div className="panel mt-12 flex flex-col gap-3 px-4 pb-4 text-sm">
      <PanelHead img="/art/crew_slime.webp" title="NEED FUEL!" />
      <p className="text-center"><b>⚠ Devnet burner</b> {useBurner && burner ? short(burner.publicKey.toBase58()) : ""} needs a little devnet SOL for fees (has {sol?.toFixed(3)}).</p>
      <button onClick={airdrop} disabled={!!busy} className="btn3d btn-lime h-12 text-base">Airdrop 1 devnet SOL</button>
      <a className="text-center text-xs underline" href="https://faucet.solana.com" target="_blank" rel="noreferrer">Airdrop rate-limited? Use faucet.solana.com with the address above</a>
    </div>
  );
  if (stage === "start") return (
    <div className="panel mt-12 flex flex-col gap-3 px-4 pb-4 text-sm">
      <PanelHead img="/art/token.webp" title="BUY CREDITS" />
      <p className="text-center font-semibold text-white/85">1 credit = 1 dUSDC = 1 drop. One approval opens a <b className="text-[var(--gold)]">session key</b> that can only move, drop and queue. It can never withdraw.</p>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label="Credit amount">
        {[1, 3, 5, 10].map((n) => (
          <button key={n} onClick={() => setCredits(n)} aria-pressed={credits === n}
            className={`btn3d h-14 flex-col gap-0 text-2xl ${credits === n ? "btn-gold" : "btn-violet"}`}>
            {n}<span className="text-[10px] leading-none">CREDITS</span>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-center gap-3">
        <button aria-label="Fewer credits" className="btn3d btn-violet h-11 w-11 text-xl" onClick={() => setCredits(Math.max(1, credits - 1))}>−</button>
        <span className="title-stroke font-display w-44 text-center text-xl">{credits} for {credits} dUSDC</span>
        <button aria-label="More credits" className="btn3d btn-violet h-11 w-11 text-xl" onClick={() => setCredits(Math.min(20, credits + 1))}>+</button>
      </div>
      <p className="text-center text-xs text-white/70">{usdc >= BigInt(credits) * 1_000_000n ? `You have ${(Number(usdc) / 1e6).toFixed(2)} dUSDC.` : "You'll get 20 free demo dUSDC from the devnet faucet in the same transaction."}</p>
      <button onClick={start} disabled={!!busy} className="btn3d btn-pink h-14 text-2xl">START SESSION</button>
    </div>
  );
  return (
    <div className="panel mt-12 flex flex-col gap-3 px-4 pb-4 text-sm">
      <PanelHead img="/art/trophy.webp" title="WELCOME BACK" />
      <p className="text-center">Your profile is still on the rollup from an earlier session, but this browser has no valid session key. Cash out to settle any prizes, then start a new session.</p>
      <button onClick={cashOut} disabled={!!busy} className="btn3d btn-gold h-12 text-base">Cash out &amp; claim</button>
    </div>
  );
}

function Onboarding({ done }: { done: () => void }) {
  const steps = [
    ["/art/mascot_base.webp", "One claw, every player", "This cabinet is shared live on a MagicBlock Ephemeral Rollup. Capsules stay where they land for the next player."],
    ["/art/claw_open.webp", "Aim in 3D", "FRONT view shows left and right. SIDE view shows depth. Switch views to line the claw up, then hit DROP."],
    ["/art/cap_mystery.webp", "Skill × VRF", "Your aim sets the grip chance (85% dead centre, 25% at the edge). MagicBlock VRF rolls it. Slimy mystery capsules stay sealed until they fall. Prizes pay out to your wallet."],
  ];
  const [i, setI] = useState(0);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(10,2,20,0.75)] p-4" role="dialog" aria-modal aria-label="How to play">
      <div className="panel pop-in mb-4 w-full max-w-md px-5 pb-5 pt-2" key={i}>
        <div className="-mt-16 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={steps[i][0]} alt="" className="float h-32 w-auto drop-shadow-[0_10px_12px_rgba(0,0,0,0.6)]" />
        </div>
        <div className="mt-1 flex justify-center gap-1.5" aria-label={`Step ${i + 1} of 3`}>
          {steps.map((_, k) => <span key={k} className={`h-2.5 rounded-full border border-[var(--ink)] ${k === i ? "w-7 bg-[var(--gold)]" : "w-2.5 bg-white/30"}`} />)}
        </div>
        <h2 className="title-stroke font-display mt-2 text-center text-3xl">{steps[i][1]}</h2>
        <p className="mt-2 text-center text-sm font-semibold text-white/90">{steps[i][2]}</p>
        <div className="mt-5 flex items-center justify-between gap-3">
          <button className="h-11 px-3 text-sm font-bold text-white/70 underline" onClick={done}>Skip</button>
          <button className="btn3d btn-gold h-12 flex-1 text-xl" onClick={() => (i < 2 ? setI(i + 1) : done())}>{i < 2 ? "Next" : "Let's go!"}</button>
        </div>
      </div>
    </div>
  );
}
