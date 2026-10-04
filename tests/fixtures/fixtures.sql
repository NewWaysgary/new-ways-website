-- TEST DATA for the local copy only (loaded when TEST_FIXTURES=1). Never part of the real database.
INSERT INTO mediums (date, name, location, description, photo_key, visible) VALUES
(date('now', '-7 days'), '[Test] Past medium', 'Nowhere', 'Should not appear: this Wednesday has passed.', '', 1),
(date('now', 'weekday 3'), '[Test] First medium', 'Glasgow', 'A test description for the first guest medium.

A second paragraph to check spacing.', 'test/portrait.jpg', 1),
(date('now', 'weekday 3', '+7 days'), '[Test] Second medium', 'Edinburgh', 'A test description for the second medium.', 'test/portrait.jpg', 1),
(date('now', 'weekday 3', '+14 days'), '[Test] Third medium', '', '', '', 1),
(date('now', 'weekday 3', '+21 days'), '[Test] Hidden medium', 'Perth', 'Should not appear: hidden.', '', 0);
INSERT INTO events (name, date, time_text, summary, details, ticket_info, ticket_url, poster_key, visible) VALUES
('[Test] Past event', date('now', '-3 days'), '7pm', 'Should not appear.', '', '', '', '', 1),
('[Test] Evening of mediumship', date('now', '+20 days'), '7pm to 9:30pm', 'A short test description of the event.', 'The full test information appears here when opened.', 'Tickets £12', 'https://square.link/u/TEST', 'test/poster.jpg', 1),
('[Test] Event without tickets', date('now', '+40 days'), '', 'No ticket link, so no button.', '', '', '', '', 1);
