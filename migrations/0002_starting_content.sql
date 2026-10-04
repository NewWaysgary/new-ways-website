-- Starting content taken from the New Way's specification. Everything here can be changed in Admin.
-- Nothing is invented: unknown details are left empty and stay hidden until Gary adds them.

INSERT INTO content_blocks (key, title, body) VALUES
('home_welcome', 'Welcome to New Way’s',
'New Way’s is a community focused spiritual centre based at Thomson Park in Dundee.

Each Wednesday evening we bring people together through Spirit, mediumship, development and community.

We welcome a different guest medium each week, followed by our Development Circle.

Everyone is welcome.'),

('development_circle', 'Development Circle with Medium Gary Findlay',
'The Development Circle at New Way’s is open to everyone, whether completely new to mediumship or developing for years.

Gary’s way of teaching is simple. Mediumship is about feeling, not forcing.

The purpose is to help people understand what they are actually feeling and recognise when Spirit draws close.

During the circle, practical exercises are used to help people:
- Quiet the mind
- Understand their own energy
- Feel the presence of Spirit
- Build confidence in their connection
- Trust what they receive
- Develop at their own pace

Everyone develops differently. There is no pressure or expectation to work like somebody else.

No previous experience is required. People do not need to call themselves a medium.

They can simply come with an open mind and experience it for themselves.'),

('about_welcome', 'Welcome to New Way’s',
'New Way’s is a community focused spiritual centre based at Thomson Park, Napier Drive, Dundee.

Each Wednesday evening we open our doors to bring people together through Spirit, healing and connection.

We welcome a different guest medium each week, giving those attending the opportunity to receive comfort, guidance and messages from loved ones in Spirit.

After the demonstration there is time to relax, chat and enjoy tea, coffee and biscuits before moving into the Development Circle.

New Way’s has become an important part of the local community. It is a place where people feel supported, welcomed and valued and where friendships have been formed.

Everyone is welcome at New Way’s.'),

('our_story', 'Our story',
'New Way’s began with a simple mission: to create a supportive space where people feel safe, welcomed and able to grow spiritually.

From its early gatherings to the busy weekly evenings held today, the centre has remained focused on bringing people together through Spirit, development, healing and community.

As New Way’s begins its new chapter at Thomson Park, the purpose remains the same: creating a warm, welcoming and supportive space where people can come together.'),

('wwd_services', 'Weekly mediumship services',
'Each week New Way’s welcomes a different medium from across Scotland.'),

('wwd_break', 'Community break',
'A chance to relax with tea, coffee, biscuits and friendly conversation. Many friendships have been formed through New Way’s.'),

('wwd_circle', 'Development Circle',
'Led by Medium Gary Findlay, giving people the opportunity to learn, explore and develop their own spiritual connection at their own pace.'),

('mission', 'Our mission',
'Our mission is simple:
- To bring people together through Spirit
- To offer comfort, support and healing
- To create a community where everyone feels welcome
- To help individuals explore and understand their own spiritual path
- To provide a space where people feel valued and uplifted

New Way’s isn’t just a centre. It’s a community.'),

('community', 'Community',
'At New Way’s, no one is just a visitor.

From the moment you step through the doors of Thomson Park, you become part of a community built on kindness, support and genuine connection.

People come for Spirit, but many stay because they feel welcomed and part of something.

New Way’s is more than a spiritual centre. It is a place where friendships are formed and confidence grows.

You’re always welcome here.'),

('private_readings', 'Private readings',
'Private readings are available with Medium Gary Findlay.'),

('charity_intro', 'Community and charity', ''),

('teaching_intro', 'Teaching videos', ''),

('privacy_notice', 'Privacy notice',
'This notice explains what information the New Way’s website and app collect and how it is used.

# Who we are
New Way’s Mediumship Development Centre, {Address}. You can contact us using the details on our Find Us page.

# Sharing your experience
If you share your experience of New Way’s, we keep the name you give, your star rating if you choose one, what you write, and whether you agree to it being shown publicly. Nothing is shown on the site until we have read and approved it, and only if you agreed. Experiences we decide not to publish are deleted within 30 days.

# Bookings and payments
Private readings and event tickets are booked and paid for through Square. Square handles that information under its own privacy policy. We do not copy booking or payment details into this website.

# Technical information
Like all websites, the service that runs this site (Cloudflare) processes technical details such as your IP address to deliver pages securely and to block abuse. The experience form uses Cloudflare Turnstile to stop spam, and we keep short-lived technical records for the same reason.

# Cookies and your device
We do not use advertising or tracking cookies, and we do not sell or share your information for marketing. If you use the music control, your choice is remembered on your own device only.

# Videos and lettering
Teaching videos and livestreams play through YouTube, which may set its own cookies when you play a video. The lettering on the site is loaded from Google Fonts.

# Your rights
You can ask to see, correct or remove anything you have shared with us by contacting us. You also have the right to complain to the Information Commissioner’s Office at ico.org.uk.');

INSERT INTO charity_totals (charity_name, amount_pence, date_label, sort_order) VALUES
('Help for Kids', 340900, 'November 2025', 1),
('Cash for Kids', 249300, 'November 2024', 2),
('Angus Cat Rescue', 179500, 'November 2023', 3);

INSERT INTO faqs (question, answer, sort_order) VALUES
('What happens on a Wednesday evening?',
'Doors open at {Doors open} and the service starts at {Service starts}. A guest medium gives a demonstration of mediumship.

Afterwards there is time to relax, chat and enjoy tea, coffee and biscuits before moving into the Development Circle.', 1),
('Do I need to book?', '{Booking} for Wednesday evenings. Just come along.', 2),
('Can I just turn up?', 'Yes. Doors open at {Doors open} every Wednesday evening.', 3),
('What time do the doors open?', 'Doors open at {Doors open}.', 4),
('What time does the service start?', 'The service starts at {Service starts}.', 5),
('How much is entry?', 'Entry is {Entry price}. {Payment}.', 6),
('Can I pay by card?', '{Payment}.', 7),
('What happens during a mediumship service?',
'Each week we welcome a different guest medium, giving those attending the opportunity to receive comfort, guidance and messages from loved ones in Spirit.', 8),
('Is everyone welcome?', 'Yes. Everyone is welcome at New Way’s.', 9),
('Can I stay for the Development Circle?',
'Yes. After the service there is time to relax with tea, coffee and biscuits, then the Development Circle begins. It costs {Circle price}.', 10),
('Do I need experience for the Development Circle?',
'No previous experience is required. The circle is open to everyone, whether completely new to mediumship or developing for years.', 11),
('How much is the Development Circle?', 'The Development Circle is {Circle price}. {Payment}.', 12),
('Is there parking?', '{Parking}', 13),
('How do I get to Thomson Park?', 'New Way’s is at {Address}.

{Public transport}', 14),
('Do I need to be religious or a Spiritualist to attend?', '', 15),
('What should I expect on my first visit?',
'Just come along on a Wednesday evening. Doors open at {Doors open} and the service starts at {Service starts}. Entry is {Entry price}.

A guest medium gives a demonstration, then there is time to relax with tea, coffee, biscuits and friendly conversation. You are welcome to stay for the Development Circle afterwards.', 16);
