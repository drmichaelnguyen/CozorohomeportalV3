# Member Ranking Calculator

This document explains the Cozoro Member ranking logic used by the app.

Primary code reference:

- `api/src/google-sheets.ts`

## Tier Order

- Silver
- Gold
- Platinum
- Diamond
- Elite

## What Each Number Means

There are three different numbers involved in member ranking. They are separate rules.

### 1. Number of coins needed to level up

This means:

- all-time accumulated coins

This is based on lifetime accumulated coins, not current balance and not just last month's earnings.

Thresholds:

- Silver: `0`
- Gold: `100,000`
- Platinum: `150,000`
- Diamond: `300,000`
- Elite: `800,000`

### 2. Minimum coins earned in the previous month

This means:

- coins earned during the previous calendar month

The app calculates this from positive coin transactions in the coins sheet for the previous month.

Maintenance and upgrade eligibility thresholds:

- Silver: `0`
- Gold: `5,000`
- Platinum: `10,000`
- Diamond: `20,000`
- Elite: `40,000`

### 3. Upgrade cost

This means:

- current coins that must be spent when upgrading into that tier, if that tier has a non-zero upgrade fee
- this is a one-time upgrade payment, not a monthly payment
- if the member stays at that rank, they do not pay again
- if the member loses that rank and later upgrades back to it, they must pay that tier's upgrade cost again

Upgrade costs:

- Silver: `0`
- Gold: `0`
- Platinum: `0`
- Diamond: `10,000`
- Elite: `40,000`

## Upgrade Rule

To upgrade to a target tier, a member must satisfy all three conditions:

1. `Accumulated coins condition`
   Total accumulated coins must reach the target tier threshold.

2. `Previous month condition`
   Previous month's earned coins must reach the target tier maintenance requirement.

3. `Upgrade payment condition`
   Current coins must be enough to pay the target tier's upgrade cost, if any.

Important:

- the upgrade cost is only charged when actually moving up into that tier
- it is not charged again while the member continues holding that same tier
- it becomes required again only if the member dropped to a lower tier and later upgrades back

## Worked Examples

### Example: Upgrade to Gold

Required:

- accumulated coins `>= 100,000`
- previous month's earned coins `>= 5,000`
- upgrade cost `0`

### Example: Upgrade to Platinum

Required:

- accumulated coins `>= 150,000`
- previous month's earned coins `>= 10,000`
- upgrade cost `0`

### Example: Upgrade to Diamond

Required:

- accumulated coins `>= 300,000`
- previous month's earned coins `>= 20,000`
- current coins `>= 10,000`

### Example: Upgrade to Elite

Required:

- accumulated coins `>= 800,000`
- previous month's earned coins `>= 40,000`
- current coins `>= 40,000`

## Downgrade / Maintenance Rule

The app also uses the previous month's earned coins to decide whether a member keeps their recorded tier.

Meaning:

- if a member does not meet the maintenance requirement for their recorded tier, they can lose that tier
- the app then falls back to the best tier that matches both:
  accumulated coins
  previous month's earned coins

Examples:

- if a member has enough lifetime coins for Diamond but only earned `8,000` last month, they do not maintain Diamond
- if they still satisfy Platinum or Gold rules, the app can drop them to that matched tier

## Current Tier Benefit Table

### Silver

- Exchange rate: `60%`
- Free laundry: `01 dryer`
- Maintain requirement: `0`
- Upgrade cost: `0`

### Gold

- Exchange rate: `70%`
- Free laundry: `01 wash + 01 dryer`
- Maintain requirement: `5,000`
- Upgrade cost: `0`

### Platinum

- Exchange rate: `80%`
- Free laundry: `01 wash + 02 dryers`
- Maintain requirement: `10,000`
- Upgrade cost: `0`

### Diamond

- Exchange rate: `90%`
- Free laundry: `03 washes + 03 dryers`
- Maintain requirement: `20,000`
- Upgrade cost: `10,000`

### Elite

- Exchange rate: `100%`
- Free laundry: `03 washes + 03 dryers`
- Maintain requirement: `40,000`
- Upgrade cost: `40,000`
- D7 ranking note: one small locker benefit

## Inputs Used By The App

The app uses these inputs:

- `Tổng Coins tích luỹ`
  All-time accumulated coins
- `Cozoro Member`
  Recorded current tier
- `Cozoro coins hiện có`
  Current coin balance used to pay upgrade cost
- `COZORO COINS` sheet positive entries from the previous month
  Used to calculate previous month's earned coins

## Important Clarification

When someone says:

- `300,000 coins to reach Diamond`

that does not mean one single rule by itself.

For Diamond, the full rule is:

- accumulated coins must be at least `300,000`
- previous month's earned coins must be at least `20,000`
- current coins must be at least `10,000` to pay the upgrade cost

All three must be true for the upgrade to succeed.
