# ახალი პლატფორმის დამატება

შუამავალი (`services/integrations`) ორ ნაწილად არის გაყოფილი:

- **ბირთვი** (`hub.js`) პლატფორმაზე არაფერი იცის. ინახავს სესიებს, ტრანზაქციების ჟურნალს (ერთი და იგივე id ორჯერ არ ტარდება) და ფრიბეტებს.
- **ადაპტერი** (`adapters/<name>.js`) თარგმნის ერთ კონკრეტულ პლატფორმაზე: ველების სახელები, ჰეში, შეცდომის კოდები, URL-ები.

თამაში მხოლოდ ბირთვს ელაპარაკება, ერთნაირად ყველა პლატფორმისთვის:

| ქმედება | თამაში → შუამავალი |
|---|---|
| შესვლა | `GET /sessions/:token` |
| ბალანსი | `GET /sessions/:token/balance` → `{ balance }` (ცენტები) |
| ფსონი | `POST /sessions/:token/tx` `{ id, kind: 'bet', roundId, amount }` |
| მოგება | `{ id, kind: 'win', roundId, amount }` (წაგებისას `amount: 0`, თუ ადაპტერი ითხოვს) |
| დაბრუნება | `{ id, kind: 'rollback', roundId, amount, ref: <bet-ის id> }` |

## ნაბიჯები

1. შექმენი `adapters/<name>.js` (ნიმუში ქვემოთაა). ყველაზე ახლოს მდგომი მაგალითია `upgaming.js`.
2. დაარეგისტრირე `adapters/index.js`-ში: `import foo from './foo.js'` და `ADAPTERS = { upgaming, foo }`.
3. დაამატე პლატფორმა კონფიგურაციაში (`INTEGRATIONS` ან `INTEGRATIONS_FILE`):
   ```json
   [{ "id": "foo-live", "adapter": "foo", "walletUrl": "https://…", "secret": "…" }]
   ```
   `id` URL-ის ნაწილი ხდება: პლატფორმა ჩვენს API-ს იძახებს `https://<ჩვენი დომენი>/p/foo-live/…`-ზე. ერთ ადაპტერს რამდენიმე კონფიგურაცია შეიძლება ჰქონდეს (მაგ. სატესტო და რეალური ოპერატორი).
4. დაწერე ტესტი `test/integrations/`-ში. თუ პლატფორმას სატესტო გარემო არ აქვს, გააკეთე სიმულატორი `demo/`-ში, როგორც `demo/upgaming-operator`.

## ადაპტერის ინტერფეისი

```js
import { PlatformError } from '../errors.js';

export default function foo(cfg, hub) {
  // cfg — პლატფორმის კონფიგურაცია; hub — ბირთვის დამხმარეები:
  //   hub.games(), hub.findGame(id), hub.url(path),
  //   hub.createSession(cfg.id, { playerId, currency, platformSessionId, gameId, device, locale, lobbyUrl }) → { token, url }
  //   hub.addFreebet(cfg.id, {...}), hub.cancelFreebet(cfg.id, id)
  return {
    // წაგებული რაუნდი დაიხუროს WIN 0-ით? (ზოგი პლატფორმა ამას მოითხოვს)
    closeRoundWithZeroWin: false,

    // პლატფორმა → ჩვენ: [method, path, handler]. path-ს წინ ავტომატურად ემატება /p/<id>
    routes: [
      ['GET', '/games', ({ query, req }) => hub.games().map(g => ({ id: g.id, title: g.name }))],
      ['POST', '/launch', ({ body }) => ({ url: hub.createSession(cfg.id, { … }).url })]
    ],

    // ნებისმიერი შეცდომა → პლატფორმის ფორმატი
    formatError(e) { return { status: e.status || 500, body: { error: e.code || 'INTERNAL' } }; },

    // ჩვენ → პლატფორმა. თანხები ყოველთვის ცენტებშია (მთელი რიცხვი)
    async balance(session) { /* … */ return 12345; },
    async transact(session, tx) {
      // tx: { id, kind: 'bet'|'win'|'rollback', roundId, amount, ref? }
      // შეცდომისას: throw new PlatformError('INSUFFICIENT_FUNDS', 'მესიჯი', 403)
      // თუ პლატფორმა ამბობს „უკვე დამუშავებულია“ — ეს წარმატებაა (იგივე id ხელახლა გაიგზავნა)
      return { balance: 12345, platformTx: 'პლატფორმის tx id' };
    }
  };
}
```

## შეცდომები და ხელახალი ცდა

- `INSUFFICIENT_FUNDS`, `SESSION_EXPIRED` და მსგავსი: მოთამაშე გასაგებ შეტყობინებას ხედავს.
- `PLATFORM_UNAVAILABLE` (ან 5xx): პასუხი არ მოვიდა. ფსონის შემთხვევაში თამაში უსაფრთხოებისთვის დაბრუნებას (rollback) აყენებს რიგში. მოგებები და დაბრუნებები რიგით იგზავნება, სანამ პლატფორმა არ დაადასტურებს, ყოველთვის იმავე `id`-ით.
- 4xx კოდით საბოლოო უარი რიგს აღარ აჩერებს: იწერება ჟურნალში (`ledger.jsonl`, `ext_rejected`).
