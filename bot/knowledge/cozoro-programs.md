# Cozoro Programs and Service Rules

This note is a customer-facing knowledge summary compiled from the public Cozoro Coins page and the current web app configuration.

Source references:

- Public page: https://cozorohome.com/cozorocoins/
- Project file: /mnt/c/Users/User/Desktop/cozorohome webapp/portal/lib/cozoro-member.ts
- Project file: /mnt/c/Users/User/Desktop/cozorohome webapp/portal/components/laundry-fee-client.tsx
- Project file: /mnt/c/Users/User/Desktop/cozorohome webapp/portal/components/cleaning-schedule-client.tsx

## Cozoro Coins overview

- Cozoro Coins are a loyalty and reward system for Cozoro customers.
- Customers can accumulate coins from long stays, support activities, cleaning contributions, referrals, reviews, and other approved actions.
- Coins can be used for certain Cozoro services and internal bill support.

## Cozoro Member tiers

- Tier order: Silver -> Gold -> Platinum -> Diamond -> Elite.
- Silver: base tier.
- Gold: reached at 100,000 accumulated coins.
- Platinum: reached at 150,000 accumulated coins.
- Diamond: reached at 300,000 accumulated coins.
- Elite: reached at 800,000 accumulated coins and above.

Current app rules define these tier benefits:

- Silver:
  - VND exchange support rate: 60%
  - Free laundry: 01 dryer per month
  - Monthly maintain coins: 0
  - Upgrade cost: free
- Gold:
  - VND exchange support rate: 70%
  - Free laundry: 01 wash + 01 dry per month
  - Monthly maintain coins: 5,000
  - Upgrade cost: free
- Platinum:
  - VND exchange support rate: 80%
  - Free laundry: 01 wash + 02 dry per month
  - Monthly maintain coins: 10,000
  - Upgrade cost: free
- Diamond:
  - VND exchange support rate: 90%
  - Free laundry: 03 wash + 03 dry per month
  - Monthly maintain coins: 20,000
  - Upgrade cost: 10,000 coins if the member lost status and wants to upgrade back
- Elite:
  - VND exchange support rate: 100%
  - Free laundry: 03 wash + 03 dry per month
  - Monthly maintain coins: 40,000
  - Upgrade cost: 40,000 coins if the member lost status and wants to upgrade back
  - D7 ranking note: one small locker benefit

Upgrade eligibility rule:

- A member must satisfy all of these to upgrade to a target tier:
  - `Accumulated coins condition`: total lifetime accumulated coins must reach that tier threshold
  - `Previous month condition`: previous month's earned coins must reach that tier maintenance requirement
  - `Upgrade payment condition`: if that tier has an upgrade cost, the member must also spend that amount of current coins
- That upgrade cost is one-time only when moving up into that tier
- If the member stays at that tier, they do not pay that upgrade cost again
- If the member loses that tier and later upgrades back, the upgrade cost applies again

Example:

- To upgrade to Diamond:
  - accumulated coins must be at least `300,000`
  - previous month's earned coins must be at least `20,000`
  - current coins must cover the `10,000` coin upgrade cost

Important clarification:

- The first row in the ranking table, `number of coins needed to level up`, means `all-time accumulated coins`
- It does not mean current balance
- It does not mean only previous month's earnings
- Previous month's earnings are a separate requirement for upgrade and maintenance
- Upgrade cost is a third separate requirement when the target tier has a non-zero upgrade fee
- That fee is not a monthly maintenance charge

## Typical ways to earn coins

- Contract rewards:
  - 3-month contract: 10,000 coins
  - 6-month contract: 25,000 coins
  - 12-month contract: 50,000 coins
- Continuous stay rewards:
  - 6 months: 30,000 coins
  - 12 months: 20,000 coins
- Support and community rewards:
  - Bring a guest to view: 10,000 coins
  - Bring a guest to sign a contract: 100,000 coins
  - Report broken equipment or policy violations: 2,000 coins
  - Cleaning duty completed well: usually 3,000 to 6,000 coins depending on membership tier
  - Extra cleaning duty: usually 3,000 to 6,000 coins depending on membership tier
  - Monthly dorm review: 5,000 to 6,000 coins depending on membership tier
  - Referral for a friend signing a 6-month contract: 500,000 coins

## Typical ways to use coins

- Laundry wash or dry: 7,000 coins per use
- VND payment support for rent or parking: up to 10% of each bill
- 100,000+ coins may be converted into VND support based on the member exchange rate
- Fine payment by coins:
  - Silver to Gold style calculation: around 1.5x the bill value in coins
  - Platinum and above: around 2x the bill value in coins

## Important Cozoro Coins FAQ points

- Member ranking is reviewed monthly.
- Ranking depends mainly on the previous month's earned coins, while accumulated-coin thresholds determine which tiers are available.
- A customer can be downgraded if they do not meet the monthly coin maintenance requirement for their tier.
- If a customer is downgraded, Gold and Platinum can be upgraded back for free, while Diamond and Elite require the configured upgrade coin cost.
- The Diamond or Elite upgrade fee is only charged when the customer upgrades back after losing that tier, not while they continue holding it.
- If a contract expires and is not renewed in time, the customer may lose their accumulated coins.
- Coins cannot be converted directly into cash payouts.
- Coins cannot currently be gifted or transferred to another person.
- Using coins for laundry does not remove the historical accumulated coins used for rank calculation.
- If an account balance becomes negative, Cozoro may convert that balance using a rate of 1 coin = 2 VND for collection.

## Laundry pricing and payment methods

Current app configuration shows these laundry machine prices:

- D2 Washer: 7,000
- D7 Vertical Washer: 7,000
- D7 Whirlpool Washer: 7,000
- D7 Dryer: 7,000

Supported payment methods in the app:

- FREE_LAUNDRY
- COINS
- CASH

## Cleaning scheduling and release rules

Current app behavior includes these customer-facing cleaning scheduling rules:

- Kitchen D7 completion window: 17:00 to 23:00 on the assigned date.
- Other listed cleaning task types can usually be completed any time on the assigned date.
- Releasing a task on the same day may cause a 75% fine.
- Releasing 1 to 4 days ahead may cause a 50% fine.
- Releasing 5 or more days ahead usually has no fine.
- Self-assigned tasks released 5 or more days ahead are treated more leniently and may not count against the monthly release limit.

## Answering guidance for the bot

- Treat this file as customer-safe guidance, not as a legal contract.
- If a question depends on a specific signed contract, current invoice, personal coin balance, or a live booking, the bot should ask staff to verify it.
- If the public page and the app configuration ever conflict, staff should confirm the latest official rule before promising an exact benefit.
