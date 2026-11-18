use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::{associated_token::AssociatedToken, metadata::{self, CreateMetadataAccountsV3, CreateMasterEditionV3, Metadata, mpl_token_metadata::types::DataV2}, token::{self, Mint, Token, TokenAccount, MintTo}};
use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2,get_feed_id_from_hex};

declare_id!("6hv79zuF9vjoiiYE6KTCXXbKLJfdiEKDndNjBsGRCU97");
const USD_PRICE:u128=200;
const LAMPORTS:u128=1_000_000_000;
const SOL_USD_FEED:&str="ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

#[program]
pub mod blocksonar_membership {
 use super::*;
 pub fn initialize(ctx:Context<Initialize>,max_supply:u64,max_price_age:u64,base_uri:String)->Result<()> {
  require!(max_supply>0 && max_price_age>0 && max_price_age<=300,MembershipError::InvalidConfiguration);
  require!(!base_uri.is_empty() && base_uri.len()<=180,MembershipError::InvalidConfiguration);
  let config=&mut ctx.accounts.config;
  config.deployer=ctx.accounts.deployer.key();config.price_account=ctx.accounts.price_update.key();config.max_supply=max_supply;config.total_minted=0;config.max_price_age=max_price_age;config.minting_open=false;config.bump=ctx.bumps.config;config.treasury_bump=ctx.bumps.treasury;config.base_uri=base_uri;
  // Validate the configured canonical price account before accepting purchases.
  read_price(&ctx.accounts.price_update,max_price_age)?;
  Ok(())
 }
 pub fn set_minting_open(ctx:Context<Admin>,open:bool)->Result<()> {ctx.accounts.config.minting_open=open;Ok(())}
 pub fn mint(ctx:Context<Purchase>,serial:u64,max_lamports:u64)->Result<()> {
  let config=&ctx.accounts.config;
  require!(config.minting_open,MembershipError::MintingClosed);
  require!(config.total_minted<config.max_supply,MembershipError::SoldOut);
  require!(serial==config.total_minted.checked_add(1).ok_or(MembershipError::Arithmetic)?,MembershipError::QuoteChanged);
  let price=read_price(&ctx.accounts.price_update,config.max_price_age)?;
  let required=price_lamports(price.price,price.exponent)?;
  require!(required<=max_lamports,MembershipError::QuoteChanged);
  transfer(CpiContext::new(ctx.accounts.system_program.to_account_info(),Transfer{from:ctx.accounts.buyer.to_account_info(),to:ctx.accounts.treasury.to_account_info()}),required)?;
  let bump=[config.bump];let seeds:&[&[u8]]=&[b"config",&bump];let signers=&[seeds];
  token::mint_to(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(),MintTo{mint:ctx.accounts.mint.to_account_info(),to:ctx.accounts.buyer_token.to_account_info(),authority:ctx.accounts.config.to_account_info()},signers),1)?;
  let uri=format!("{}{}",ctx.accounts.config.base_uri,serial);
  metadata::create_metadata_accounts_v3(CpiContext::new_with_signer(ctx.accounts.metadata_program.to_account_info(),CreateMetadataAccountsV3{metadata:ctx.accounts.metadata.to_account_info(),mint:ctx.accounts.mint.to_account_info(),mint_authority:ctx.accounts.config.to_account_info(),payer:ctx.accounts.buyer.to_account_info(),update_authority:ctx.accounts.config.to_account_info(),system_program:ctx.accounts.system_program.to_account_info(),rent:ctx.accounts.rent.to_account_info()},signers),DataV2{name:"BlockSonar Lifetime Membership".into(),symbol:"SONAR".into(),uri,seller_fee_basis_points:0,creators:None,collection:None,uses:None},false,true,None)?;
  metadata::create_master_edition_v3(CpiContext::new_with_signer(ctx.accounts.metadata_program.to_account_info(),CreateMasterEditionV3{edition:ctx.accounts.edition.to_account_info(),mint:ctx.accounts.mint.to_account_info(),update_authority:ctx.accounts.config.to_account_info(),mint_authority:ctx.accounts.config.to_account_info(),payer:ctx.accounts.buyer.to_account_info(),metadata:ctx.accounts.metadata.to_account_info(),token_program:ctx.accounts.token_program.to_account_info(),system_program:ctx.accounts.system_program.to_account_info(),rent:ctx.accounts.rent.to_account_info()},signers),Some(0))?;
  let record=&mut ctx.accounts.membership_mint;record.config=ctx.accounts.config.key();record.mint=ctx.accounts.mint.key();record.serial=serial;record.bump=ctx.bumps.membership_mint;
  ctx.accounts.config.total_minted=serial;
  emit!(MembershipPurchased{member:ctx.accounts.buyer.key(),mint:ctx.accounts.mint.key(),serial,paid_lamports:required});Ok(())
 }
 pub fn withdraw(ctx:Context<Withdraw>)->Result<()> {
  let rent=Rent::get()?.minimum_balance(ctx.accounts.treasury.to_account_info().data_len());
  let amount=ctx.accounts.treasury.to_account_info().lamports().checked_sub(rent).ok_or(MembershipError::NoFunds)?;
  require!(amount>0,MembershipError::NoFunds);
  let recipient_balance=ctx.accounts.recipient.to_account_info().lamports().checked_add(amount).ok_or(MembershipError::Arithmetic)?;
  **ctx.accounts.treasury.to_account_info().try_borrow_mut_lamports()?-=amount;
  **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()?=recipient_balance;
  emit!(FundsWithdrawn{recipient:ctx.accounts.recipient.key(),amount});Ok(())
 }
}
fn read_price(account:&Account<PriceUpdateV2>,max_age:u64)->Result<pyth_solana_receiver_sdk::price_update::Price> {
 let feed=get_feed_id_from_hex(SOL_USD_FEED)?;
 let clock=Clock::get()?;let price=account.get_price_no_older_than(&clock,max_age,&feed)?;
 require!(price.price>0 && price.publish_time<=clock.unix_timestamp+5 && (price.conf as u128)*100<=price.price as u128,MembershipError::InvalidPrice);
 Ok(price)
}
pub fn price_lamports(price:i64,exponent:i32)->Result<u64> {
 require!(price>0 && (-18..=18).contains(&exponent),MembershipError::InvalidPrice);
 let scale=10u128.checked_pow(exponent.unsigned_abs()).ok_or(MembershipError::Arithmetic)?;
 let numerator=USD_PRICE.checked_mul(LAMPORTS).and_then(|v|v.checked_mul(if exponent<0{scale}else{1})).ok_or(MembershipError::Arithmetic)?;
 let denominator=(price as u128).checked_mul(if exponent>=0{scale}else{1}).ok_or(MembershipError::Arithmetic)?;
 let rounded=numerator.checked_add(denominator-1).ok_or(MembershipError::Arithmetic)?/denominator;
 require!(rounded>0,MembershipError::InvalidPrice);u64::try_from(rounded).map_err(|_|error!(MembershipError::Arithmetic))
}
#[derive(Accounts)]
pub struct Initialize<'info> {
 #[account(mut)]pub deployer:Signer<'info>,
 #[account(constraint=program.programdata_address()?==Some(program_data.key()) @ MembershipError::OnlyDeployer)]pub program:Program<'info,crate::program::BlocksonarMembership>,
 #[account(constraint=program_data.upgrade_authority_address==Some(deployer.key()) @ MembershipError::OnlyDeployer)]pub program_data:Account<'info,ProgramData>,
 #[account(init,payer=deployer,space=8+MembershipConfig::INIT_SPACE,seeds=[b"config"],bump)]pub config:Account<'info,MembershipConfig>,
 #[account(init,payer=deployer,space=8,seeds=[b"treasury"],bump)]pub treasury:Account<'info,Treasury>,
 pub price_update:Account<'info,PriceUpdateV2>,pub system_program:Program<'info,System>,
}
#[derive(Accounts)]
pub struct Admin<'info>{pub deployer:Signer<'info>,#[account(mut,seeds=[b"config"],bump=config.bump,has_one=deployer @ MembershipError::OnlyDeployer)]pub config:Account<'info,MembershipConfig>}
#[derive(Accounts)]
#[instruction(serial:u64)]
pub struct Purchase<'info>{
 #[account(mut)]pub buyer:Signer<'info>,
 #[account(mut,seeds=[b"config"],bump=config.bump)]pub config:Account<'info,MembershipConfig>,
 #[account(mut,seeds=[b"treasury"],bump=config.treasury_bump)]pub treasury:Account<'info,Treasury>,
 #[account(address=config.price_account)]pub price_update:Account<'info,PriceUpdateV2>,
 #[account(init,payer=buyer,seeds=[b"mint",serial.to_le_bytes().as_ref()],bump,mint::decimals=0,mint::authority=config,mint::freeze_authority=config)]pub mint:Account<'info,Mint>,
 #[account(init,payer=buyer,associated_token::mint=mint,associated_token::authority=buyer)]pub buyer_token:Account<'info,TokenAccount>,
 #[account(init,payer=buyer,space=8+MembershipMint::INIT_SPACE,seeds=[b"member-mint",mint.key().as_ref()],bump)]pub membership_mint:Account<'info,MembershipMint>,
 /// CHECK: Metaplex verifies the canonical metadata PDA and creates it atomically.
 #[account(mut)]pub metadata:UncheckedAccount<'info>,
 /// CHECK: Metaplex verifies the canonical edition PDA and creates it atomically.
 #[account(mut)]pub edition:UncheckedAccount<'info>,
 pub metadata_program:Program<'info,Metadata>,pub token_program:Program<'info,Token>,pub associated_token_program:Program<'info,AssociatedToken>,pub system_program:Program<'info,System>,pub rent:Sysvar<'info,Rent>,
}
#[derive(Accounts)]
pub struct Withdraw<'info>{pub deployer:Signer<'info>,#[account(seeds=[b"config"],bump=config.bump,has_one=deployer @ MembershipError::OnlyDeployer)]pub config:Account<'info,MembershipConfig>,#[account(mut,seeds=[b"treasury"],bump=config.treasury_bump)]pub treasury:Account<'info,Treasury>,#[account(mut)]pub recipient:SystemAccount<'info>}
#[account]#[derive(InitSpace)]
pub struct MembershipConfig{pub deployer:Pubkey,pub price_account:Pubkey,pub max_supply:u64,pub total_minted:u64,pub max_price_age:u64,pub minting_open:bool,pub bump:u8,pub treasury_bump:u8,#[max_len(180)]pub base_uri:String}
#[account]#[derive(InitSpace)]pub struct MembershipMint{pub config:Pubkey,pub mint:Pubkey,pub serial:u64,pub bump:u8}
#[account]pub struct Treasury{}
#[event]pub struct MembershipPurchased{pub member:Pubkey,pub mint:Pubkey,pub serial:u64,pub paid_lamports:u64}
#[event]pub struct FundsWithdrawn{pub recipient:Pubkey,pub amount:u64}
#[error_code]pub enum MembershipError{#[msg("Only the original deployer may administer or withdraw")]OnlyDeployer,#[msg("Invalid membership configuration")]InvalidConfiguration,#[msg("Minting is closed")]MintingClosed,#[msg("Membership supply is exhausted")]SoldOut,#[msg("The SOL quote or membership serial changed; retry")]QuoteChanged,#[msg("Invalid SOL/USD oracle price")]InvalidPrice,#[msg("Arithmetic outside supported range")]Arithmetic,#[msg("No withdrawable funds")]NoFunds}
#[cfg(test)]mod tests{use super::*;#[test]fn quote_rounds_up(){assert_eq!(price_lamports(100_00000000,-8).unwrap(),2_000_000_000);assert_eq!(price_lamports(3_00000000,-8).unwrap(),66_666_666_667);assert!(price_lamports(0,-8).is_err());assert!(price_lamports(-1,-8).is_err());assert!(price_lamports(1,19).is_err());}}
