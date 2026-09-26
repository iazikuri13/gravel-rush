// ჩვენი თამაშების კატალოგი — ყველა პლატფორმას ერთი და იგივე სია მიეწოდება,
// ადაპტერი მხოლოდ ველების სახელებს და ფორმატს ცვლის.
export const GAMES = [
  {
    id: '1001',
    name: 'Riviera Rush',
    type: 'crash',
    mobile: true,
    demo: false,
    freespins: false,      // crash-თამაში; ფრიბეტები ინახება, მაგრამ თამაში ჯერ არ იყენებს
    image: '/cover.svg'
  }
];

export const findGame = id => GAMES.find(g => g.id === String(id)) || null;
