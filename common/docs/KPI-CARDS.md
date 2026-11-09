# KPI cards on every page (MJ, 5 Nov 2026)

Rule: every page carries exactly 4 cards in one strip under its title, the shared strip of the Overview and the Ledger (`HomeStats`, `hm-stats` / `hm-stat`). 4 in a row on desktop, 2x2 on tablet and phone.

- Pages that draw their own strip keep it (Source "own"). Rows from `web-app/src/dashboards/kpis/` serve every other page (Source "row"); the shell draws them (one insertion in `RoleDashboard`), the guest portal's page frame (`GgPage`) draws them under the large title.
- Each row is one small read of data the page's service already returns. Money is in paise, Indian format. A failed read shows no row.
- Hotel User: no payroll or restricted money figure outside the payroll pages (which only payroll users open). Super Admin only pages stay Super Admin only.
- Exempt: only the public sign-in, change-password and onboarding pages (no app header).
- New words: `common/ui-shared/i18n/phrases/{hi,gu}/p22.ts`.
- Changed to reach 4: hotel Overview +2, platform Overview -2 (the "stuck" and "inactive" figures dropped), Accounting years +1, Payroll overview +2, payroll Companies +1, Deduction types +1, Staff emails +1, Staff meals +1, Meal price +1, Salary payments +1, Website gallery +2, guest Home +1, guest Payments +1 (the guest money card is now a 4-column row).

## Hotel console

| Page | Source | 4 cards |
| --- | --- | --- |
| Overview | own | Occupancy, Guests in the house, Arriving today, Leaving today |
| Daily report | own | Cash in the drawer tonight, Taken in today, Paid out today, Net for the day |
| Occupancy | own | Rooms filled, Average price of a sold room, Income per room in service, Room income |
| GST summary | own | GST collected, Billed before tax, Company bills, Guest bills |
| Meal plans | own | Food plan to charge the hotel, Guests on a plan, Person-nights, Most taken |
| Accounting years | own | Cash brought forward, Still open from before, Entries this year, Years on file |
| Room board | own | Occupancy, Guests in the house, Arriving today, Leaving today |
| Reservations, Reservation form | row | Arriving today, Coming up, In the house, Cancelled |
| Reservation (detail) | own | Nights, Rooms, Room total, Paid in advance |
| In-house guests | row | In the house, Leaving today, Past leaving date, Checked out |
| Stay (detail) | own | Nights, Total with tax, Advance paid, Balance to pay |
| Check in | row | Arriving today, In the house, Rooms free, Leaving today |
| Rooms | row | Rooms, Vacant, Needs cleaning, Out of order |
| Guest requests, Guest messages | row | Waiting, Asked today, Older, Rooms asking |
| Dining orders | row | Open orders, Just placed, Being made, On the way |
| Email | own | Unread, Waiting, Mine, Unassigned |
| WhatsApp | own | All, Unread, Waiting, Closing |
| Bills, Advances | own | the server's figures, cut to 4 |
| Revenue, Expenses | own | Deposited / Paid out today, This month, and the server's next two |
| Handover | own | Handovers today, Cash counted today, This month, Last handover |
| Companies | own | Companies, With a GST number, People on file, Added this month |
| Ledger | own | Owed to us, Held in advance, Billed this month, Received this month |
| Company statement | own | Owes us / In credit, Billed, Received, Last payment / Brought forward |
| Customers | own | Customers, Signed up themselves, With an email, Added this month |
| Email campaigns | own | Sent, Emails, Reach, Opt-outs |
| Notices | row | Sent, Showing now, Withdrawn, Ended |
| Notice (detail) | own | Sent to, Read, Not read yet, Shown until |
| Payroll overview | own | Net salary, Paid, Still to pay, Paid so far |
| Payroll companies | own | Companies, Staff on payroll, Not fully paid, Still to pay |
| Staff | own | Active staff, Monthly salary, Joined this year, Paid by bank |
| Attendance | own | On the sheet, Entries saved, Still to mark, Overtime |
| Attendance marks | own | Marks, Paid, Unpaid, Skip meals |
| Deduction types | own | Deductions, Switched off, Given to staff, Staff records |
| Staff emails | own | Sent, All emails, Not sent, Today |
| Salary changes | own | Staff, Monthly salary, Revised this year, Never revised |
| Staff advances | own | Total issued, Recovered, Outstanding, Open advances |
| Bonus and incentives | own | Bonus, Incentive, Above salary, Staff |
| Staff meals | own | Price a person, On meals today, Not on meals, the month's bill |
| Meal price | own | Price today, Last changed, Prices on file, Fixed up to |
| Salary payments | own | Net payable, Paid, Paid in full, Still to pay |
| Payslips | own | Slips, Net, Paid, Outstanding |
| Monthly and Period report | own | Staff, Net salary, Staff meals, Total |
| Resignations | own | In notice, Relieved, Rejoined, All exits |
| Joining letter, Experience letter, Payroll settings | row | Companies, Active, Staff on payroll, Without staff (no money) |
| Payroll log | own | Entries, Today, Emails sent, Problems |
| Website | own | Enquiries, Confirmed, Cancelled, Arriving this week |
| Website enquiries | own | To answer, Confirmed, Cancelled, All enquiries |
| Website rates | own | Room categories, Rate plans, Paused, Without a rate |
| Website gallery | own | Photos, With a caption, With a description, Need a caption |
| Website rooms, Room form, Rates and rooms calendar | row | Room types, Rooms in all, Taking enquiries, Showing a price |
| Website content | row | Texts written, Texts empty, Texts in all, Complete |
| Website services, House rules, Nearby places | row | Room types, Services, House rules, Nearby places |
| Website settings | row | Check-in, Check-out, Contact details set, Links set |
| Hotel settings | row | Rooms, Vacant, Users, In the recycle bin |
| Lists and rates | row | Lists, Items, Lists with items, Empty lists |
| Guest portal | row | In the house, Arriving today, Coming up, Checked out |
| Company portal | row | Companies, Owing, In credit, Settled |
| Online payments | own | Collected today, This month, Failed, Rejected |
| Users | own | Accounts, Active, Locked, Have signed in |
| Roles | own | Accounts, Allowed in total, Ticked here, Sensitive |
| Activity log, Override log | own | Entries, Today, and two more (locks and checks stepped past / people and did not work) |
| System health | own | the health figures |
| My profile | row | In the house, Arriving today, Leaving today, Rooms free |

## Platform console

| Page | Source | 4 cards |
| --- | --- | --- |
| Overview | own | Active, Created this month, Suspended, Hotel admins |
| Hotels | row | Hotels live, Waiting for review, Suspended, In a group |
| Groups | row | Groups live, Waiting for review, Waiting for admin, Hotels in groups |
| Hotel admins | row | Hotel admins, Active, Locked, Switched off |
| Archived hotels | row | Archived hotels, Can be restored, Past the grace days, Ready to delete |
| Hotel details | own | admins, Active, Locked, Disabled |
| Group details | own | Hotels, Active, Admins, Places left |
| Demo requests | row | New, Contacted, Closed, All requests |
| Invitations | row | Waiting, Form sent back, Expired, All invitations |
| Email, WhatsApp | own | as the hotel inbox |
| Central, Possible duplicates | row | Logins, Guest profiles, Company profiles, GST records |
| Announcements | row | Showing now, Coming up, Over, Read by |
| Hotel and group mail | own | Hotels, Mail running, Mail paused, Own accounts |
| Set-up centre | row | Hotels, Live, Waiting for review, Suspended |
| Platform admins | row | Platform admins, Active, Locked, Switched off |
| All users | row | All users, Active, Locked, Switched off |
| Platform settings | row | Default GST, Invitation lasts, Mail files kept, Time zone |
| Audit log | row | Entries, On the latest day, Refused, People |
| Sign-in history | row | Sign-ins, Signed in, Wrong password, Locked out |
| Platform health | row | Healthy hotels, Need a look, No backup, Database updates waiting |
| My vault | row | Items, Passwords, Bank and cards, Expiring soon |
| My profile | row | Hotels live, Groups, Waiting for review, Locked |

## Group console

| Page | Source | 4 cards |
| --- | --- | --- |
| Overview | own | Hotels, Active, Hotel admins, Month collected |
| Hotels | row | Hotels, Live, Waiting for review, Suspended |
| Hotel details | own | Admins, Active, Locked, Disabled |
| Online payments | own | Today, Month, Failed, Problems |
| Invitations, Invite hotel | row | Waiting, Form sent back, Expired, All invitations |
| Hotel admins | row | Hotel admins, Active, Locked, Switched off |
| Email | own | Unread, Waiting, Mine, Unassigned |
| My profile | row | Hotels, Live, Hotel admins, Invitations open |

## Company portal

| Page | Source | 4 cards |
| --- | --- | --- |
| Overview | own | Overdue, Last payment, Credit, Bills this month |
| Notices | row | Notices, Unread, Read, Latest |
| Bills, Bill (detail) | row | To pay, Open bills, Overdue, Oldest bill |
| Payments | row | Paid in all, Payments, Advances, Hotels paid |
| Statement | row | Billed, Paid, Refunded, Balance |
| Support | row | Raised, Waiting, Answered, Closed |
| Company, My profile | row | To pay, Paid in advance, Bills this month, Unread notices |

## Guest portal

| Page | Source | 4 cards |
| --- | --- | --- |
| Home | own | To pay, Paid, Charged, Open bills |
| Room service | row | Your room, Night, Open bills, To pay (no stay: Open bills, To pay, Overdue, Paid so far) |
| Bills, Bill (detail), Account | row | To pay, Open bills, Overdue, Paid so far |
| Payments | own | Paid, Payments, Latest, Other entries |
| Help with a payment | row | Raised, Waiting, Answered, Closed |

## Caveats

- Revenue, Expenses, Bills and Advances take their figures from the server list and are cut to 4 by the shared mapper; a server that sends fewer than 4 would show fewer.
- System health and the activity logs were counted from the code, not on screen.
- The Overview pages keep their job tiles above the strip; the strip itself is 4.

## The card (6 Nov 2026)

Every strip is now the original `.kpi` card in 4 across (2x2 under 1100 px, also on a phone): an icon in a round outline, the uppercase label, the big figure and a one-line detail chip. One component draws all of them, `KpiCard` in `groups/overview/HomeJobs.tsx` (HomeStats, the company portal figures, the Email and WhatsApp inbox cards). The look is in `areas/kit.css` (day: white card, hairline border, soft shadow, graphite and gold outline; night: dark card, light outline) and `areas/guest.css`.

- The detail chip of each card is the "Note" in the code, the second phrase listed in `phrases/{hi,gu}/p22.ts` (for example "Sent their form", "Past the due date", "Booked to arrive").
- Tone (green done, amber waiting, red went wrong, graphite neutral) and the glyph come from the card's name, or are set on the card. A red chip appears only when the count is above 0.
- Clickable cards (44 px, open an existing list): My profile of the platform, group, hotel and company consoles, Check in, and the Email and WhatsApp inbox cards (they filter the list, as before).
- Not changed to cards, left on purpose: none of the strips; the old flat `.hm-stats` rules remain in the style sheets but nothing draws them any more. The hotel Overview cash-book tiles, System health and Sign-ins already used `.kpi` and take the new look from the same CSS.
- Phone: the Email and WhatsApp strip is a sideways scroller of the same four cards; every other strip is 2x2.