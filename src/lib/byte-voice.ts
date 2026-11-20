const QUIPS = [
  "Pensa em binário, joga em xeque-mate.",
  "Cada lance vira um bit de aprendizado.",
  "Calculei 1 milhão de lances. Joguei o 1.e4 mesmo.",
  "Sem pressa: o relógio é seu, o Stockfish é meu.",
  "Erros são só dados esperando análise.",
  "Peão pequeno, ambição de dama.",
  "Rodando 100% no seu aparelho. Nenhum servidor julga seus lances.",
];

/** Frase de efeito do Byte. A semente fixa o resultado para não variar entre servidor e cliente. */
export function byteQuip(seed: number) {
  return QUIPS[Math.abs(Math.floor(seed)) % QUIPS.length];
}
