# Testes da revisão (fora do app)

Reproduz o veredito do classificador novo sobre análises do Stockfish 16 salvas em `fixtures/`
(profundidade 16, 3 linhas; e profundidade 4 para o teste de "óbvio").

    npm i chess.js esbuild
    npx esbuild new-entry.ts --bundle --format=esm --platform=node --outfile=new-bundle.mjs \
      --alias:@=<caminho do projeto>/src --external:chess.js
    # coloque kt-d16.json etc. na mesma pasta e rode:
    node run-new.mjs kt 10        # Kasparov x Topalov, 10 plies de livro
    node run-new.mjs bf 8         # Byrne x Fischer 1956

`analyze.mjs` gera novas análises com um Stockfish nativo (/usr/games/stockfish):
    node analyze.mjs partida.pgn saida-d16.json 16 3
