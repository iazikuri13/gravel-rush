import { MAX_CRASH_100 } from '../../public/shared/math.js';

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
  maxAuto: MAX_CRASH_100,
  historySize: 30,
  closeMarginMs: 30      // ფსონი არ მიიღება, თუ სტარტამდე ამაზე ნაკლები დარჩა
};
