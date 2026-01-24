use anchor_lang::prelude::*;

declare_id!("E6rus72f4agDRe7Ue5aYfEdfzFiFphnxKozj46eDCfNT");

#[program]
pub mod poke_dex {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
