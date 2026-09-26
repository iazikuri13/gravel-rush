// თამაშის წესები (თანხები ცენტებში)
export const RULES = {
  betMs: 7000,
  endMs: 4000,
  tickMs: 20,
  minBet: 100,
  maxBet: 100000,
  startBalance: 100000,
  refillBelow: 1000,
  minAuto: 101,
  maxAuto: 10_000_000,   // ×100 000.00 — ავტო-ქეშაუთის ველის ზღვარი (კოეფიციენტს ზღვარი არ აქვს)
  // მოგების ზღვარი ერთ ფსონზე (ცენტები). მიღწევისას ფსონი ავტომატურად იღებს მოგებას. MAX_WIN — ვალუტის ერთეულებში
  maxWin: process.env.MAX_WIN ? Math.round(Number(process.env.MAX_WIN) * 100) : 10_000_000,
  historySize: 30,
  closeMarginMs: 30      // ფსონი არ მიიღება, თუ სტარტამდე ამაზე ნაკლები დარჩა
};
