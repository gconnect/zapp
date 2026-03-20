# HEARTBEAT — Payment Agent

Run every 15 minutes:

1. Check for esusu circle payouts due:
   - Query circles where next_payout_date <= now AND status = 'active'
   - For each due circle: DM the admin (@telegram_username) that payout is ready
   - Message: "🔔 Circle [name] payout is due! All members have paid. Use /payout [circle_id] to release."

2. Check for failed transactions not yet notified:
   - Query transactions where status = 'failed' AND notified_admin = 0
   - Notify admin bot, mark as notified

Run every hour:

3. Check for circles where members haven't paid with < 48 hours to payout:
   - DM overdue members: "⏰ Reminder: Your [circle name] contribution of [amount] USDC is due in 2 days!"
