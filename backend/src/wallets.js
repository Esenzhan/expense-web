// Same four wallets used in the Telegram expense bot.
export const WALLETS = ["Личные", "Семья", "Бизнес", "Ремонт"];

export function isValidWallet(wallet) {
  return WALLETS.includes(wallet);
}
