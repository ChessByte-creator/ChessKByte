// Gera partidas aleatórias determinísticas e imprime, por posição, a lista de lances legais
// na ordem do shakmaty (UCI) e o índice do lance escolhido. Formato:
// G <fen_inicial>
// P <idx> <uci_escolhido> | <uci1> <uci2> ...
use shakmaty::{fen::Fen, uci::Uci, CastlingMode, Chess, EnPassantMode, Position};

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}

fn main() {
    let games: u64 = std::env::args().nth(1).and_then(|v| v.parse().ok()).unwrap_or(300);
    let mut rng = Rng(0x9E3779B97F4A7C15);
    for _ in 0..games {
        let mut pos = Chess::default();
        println!("G {}", Fen::from_position(pos.clone(), EnPassantMode::Legal));
        for _ply in 0..220 {
            let moves = pos.legal_moves();
            if moves.is_empty() {
                break;
            }
            let idx = (rng.next() % moves.len() as u64) as usize;
            let list: Vec<String> = moves
                .iter()
                .map(|m| Uci::from_move(m, CastlingMode::Standard).to_string())
                .collect();
            println!("P {} {} | {}", idx, list[idx], list.join(" "));
            pos.play_unchecked(&moves[idx]);
        }
    }
}
