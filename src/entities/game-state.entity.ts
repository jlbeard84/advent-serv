// tslint:disable:variable-name
export class GameState {
    public player_positions: number[] = [];
    public current_turn: number;
    public active_player: number;
    public flags: any[] = [];
    public rolls_left: number;
    public remaining_amount_in_roll: number;
}
