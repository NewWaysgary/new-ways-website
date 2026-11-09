# Emails to mailing-list subscribers

**Admin › Mailing list › SEND EMAIL TO SUBSCRIBERS**

1. **WRITE A NEW EMAIL**: a subject and a message (leave a blank line between paragraphs). You can also add a gold link button to an upcoming event or a Who’s On listing, with optional wording of your own.
2. **Save and preview**: the email appears as a subscriber will see it. “Dear (first name),” and the unsubscribe link are added automatically.
3. **SEND TEST EMAIL**: sends it to your own address, marked [TEST]. Sending to the subscribers is only possible after a test, and again after any change.
4. **SEND TO N SUBSCRIBERS**: tick that you've checked the test, then send. The page shows how many it will go to.
5. Each sent email has its own page: how many were sent and each person's result. **Update delivery news** asks Resend which were delivered or bounced.

**Who receives it:** only people on the mailing list with the status *subscribed*. That means those who ticked the box at checkout, joined on the Join page, or were added in Admin because they asked. Customers who didn't tick the box are never included. Booking emails (confirmations, reminders, QR codes) are separate and unaffected.

**Unsubscribing:**
- every email has the person's own unsubscribe link, plus the one-click unsubscribe that Gmail, Outlook and Apple Mail show;
- unsubscribing updates the mailing list straight away;
- anyone who unsubscribes before their copy is sent is skipped.

**Safety:**
- **never twice:** nobody can be sent the same email twice, and an email can never be sent again or changed once it has gone;
- **daily limit:** up to 80 a day (Resend's free plan allows 100 a day in all, so there's room for booking emails). Anything over that is sent automatically by the hourly job;
- **problems:** temporary problems at Resend are tried again, and permanent ones are recorded with Resend's reason. If sending is interrupted, those emails are marked as interrupted and never sent again, so nobody gets a duplicate;
- **Stop sending** stops an email part-way through.

**Checkout:** the optional invitation is now in its own gold box, “Hear about future events?”. It is never ticked for the customer.

**Public sign-up:** the Join page (`/join`) is linked from every page's footer, the home page and the table QR code.

Database: `migrations/0027_mailing_emails.sql` only adds two tables (`mail_campaigns`, `mail_campaign_recipients`).
