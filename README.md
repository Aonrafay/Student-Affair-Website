# Student Affairs Website

A comprehensive, professional website for university student affairs showcasing programs, societies, events, ambassadors, and partnerships.

## 📋 Project Overview

This website has been created following the NIIT color scheme and design principles to present a modern, user-friendly interface for student affairs management and community engagement.

## 🎨 Color Scheme (NIIT Inspired)

- **Primary Dark**: #0B3D5D
- **Primary Blue**: #1B5E9E
- **Secondary Blue**: #2E8BC0
- **Accent Gold**: #D4A574
- **Light Background**: #F8F9FA
- **White**: #FFFFFF

## 📂 Project Structure

```
Student Affair website/
├── index.html                 # Home page with hero section and quick access
├── about-head.html           # Head of student affairs profile & introduction
├── team.html                 # Team members (Graphic Designer & Management Head)
├── societies.html            # All 8 student societies
├── society-details.html      # Individual society details (President, VP, Team)
├── events.html               # Upcoming & past events tabs
├── event-details.html        # Event details with gallery & winners
├── ambassadors.html          # Ambassador slideshow
├── ambassadors-details.html  # All ambassadors profiles
├── partners.html             # Partners slideshow & categorization
├── partner-details.html      # Partner details page
├── css/
│   └── styles.css            # Main stylesheet with NIIT color scheme
├── js/
│   └── script.js             # Interactive features & animations
└── images/                   # Image assets folder
```

## 📄 Pages & Features

### 1. **Home Page (index.html)**
- Hero section with inspiring tagline
- Programs showcase (CS, SE, AI, Cybersecurity)
- Quick links to main sections
- Statistics section
- Call-to-action sections
- **Popup Feature**: Upcoming events with countdown timer

### 2. **About Head (about-head.html)**
- Head's professional photo placeholder
- Vision & mission statement
- Key initiatives
- Professional philosophy
- Achievements & recognition
- Career timeline

### 3. **Team Page (team.html)**
- Graphic Designer profile (Amina Hassan)
- Management Head profile (Muhammad Ali)
- **Facing each other layout** as requested
- Team expertise & roles
- Supporting team members
- Core values section

### 4. **Societies Page (societies.html)**
- **8 Societies Listed**:
  1. Social Services Society
  2. X-Society (Tech Innovation)
  3. Sports Society
  4. Performing Arts Society
  5. Media Society
  6. Literary Society
  7. Explorer Club
  8. Al-Mohsenin Society
- Search functionality
- Benefits of joining
- Member counts & quick access

### 5. **Society Details (society-details.html)**
- Society-specific information
- President & Vice President profiles
- Team members
- Society motive & objectives
- Key achievements
- Contact information

### 6. **Events Page (events.html)**
- **Tab System**: Upcoming & Past Events
- Event listings with dates & descriptions
- Quick details buttons
- Event statistics & impact metrics

### 7. **Event Details (event-details.html)**
- Complete event information
- Gallery section
- **Winners & Results**: 1st, 2nd, 3rd Place
- Participant feedback/testimonials
- Event statistics
- Pictures of event highlights

### 8. **Ambassadors Page (ambassadors.html)**
- **Slideshow of Featured Ambassadors**
- Ambassador highlights
- Impact statistics
- "Become an Ambassador" section
- Benefits of ambassador program

### 9. **Ambassadors Details (ambassadors-details.html)**
- All 8+ ambassadors with profiles
- University affiliation
- Contact information
- Achievements & responsibilities
- Search functionality

### 10. **Partners & Collaborators (partners.html)**
- **Featured Partners Slideshow**
- **Partner Categorization**:
  - Platinum Partners (Top tier)
  - Diamond Partners (Strategic)
  - Gold Partners (Valued)
- Partnership benefits
- Call-to-action for partnerships

### 11. **Partner Details (partner-details.html)**
- All partners with detailed information
- Programs offered
- Student benefits
- Contact persons
- Industry classifications

## 🎯 Key Features

### Interactive Elements
- ✅ Smooth navigation & mobile-responsive design
- ✅ Auto-playing carousels with manual controls
- ✅ Tab switching (Upcoming/Past events)
- ✅ Search functionality in societies & ambassadors
- ✅ Countdown timer for upcoming events
- ✅ Popup notifications for events
- ✅ Smooth scroll animations

### Design Features
- ✅ Professional color scheme (NIIT inspired)
- ✅ Mobile-first responsive layout
- ✅ Beautiful card-based designs
- ✅ Gradient backgrounds
- ✅ Font Awesome icons
- ✅ Hover animations & transitions
- ✅ Grid layouts that adapt to screen size

### User Experience
- ✅ Clear navigation menu (sticky)
- ✅ Hero sections on each page
- ✅ Consistent footer design
- ✅ Email subscription forms
- ✅ Social media links
- ✅ Contact information sections
- ✅ Breadcrumb navigation

## 📱 Responsive Design

All pages are fully responsive and work on:
- Desktop (1200px+)
- Tablet (768px - 1199px)
- Mobile (< 768px)

Mobile menu uses hamburger navigation that toggles on small screens.

## 💻 Technical Stack

- **HTML5**: Semantic markup
- **CSS3**: Modern styling with flexbox & grid
- **JavaScript**: Vanilla JS (no dependencies)
- **Font Awesome 6.4.0**: Icons

## 🚀 Getting Started

1. Extract the files to your desired location
2. Open `index.html` in your web browser
3. Navigate through pages using the menu
4. All links are internal and working

## 🎨 Customization

### Change Colors
Edit the CSS variables in `css/styles.css`:
```css
:root {
  --primary-dark: #0B3D5D;
  --primary-blue: #1B5E9E;
  --secondary-blue: #2E8BC0;
  --accent-gold: #D4A574;
  /* ... more colors */
}
```

### Add Images
- Replace placeholder image divs with `<img>` tags
- Store images in the `images/` folder
- Images are referenced in the HTML

### Update Content
- All text content can be easily edited in the HTML files
- Data-driven sections (societies, ambassadors, events, partners) have JavaScript objects that can be modified

## 📊 Data Management

### Societies Data
Edit the `societyData` object in `society-details.html`

### Events Data
Edit the `eventData` object in `event-details.html`

### Ambassadors Data
Edit the `ambassadorData` array in `ambassadors-details.html`

### Partners Data
Edit the `partnerData` array in `partner-details.html`

## ✨ Highlights

- **User-Friendly Interface**: Clean, intuitive navigation
- **Professional Design**: Following NIIT's established color scheme
- **Comprehensive Information**: All major student affairs sections covered
- **Interactive Features**: Slideshow, countdown, search, tabs
- **Mobile Optimized**: Works perfectly on all devices
- **Fast Loading**: Optimized performance
- **Accessibility**: Semantic HTML for better accessibility

## 📧 Contact & Support

- Student Affairs Email: affairs@university.edu
- Phone: +1 (555) 123-4567
- Location: Student Center, Building A
- Hours: Monday - Friday, 9 AM - 5 PM

## 📝 Notes

- All external links should be updated with real URLs
- Email links use `mailto:` protocol
- Phone numbers can be formatted for `tel:` links
- Social media icons link to placeholder pages

## 🔄 Upcoming Features

- Newsletter subscription backend
- Event registration system
- Ambassador application form
- Partner relationship management
- Analytics dashboard
- Multi-language support

---

**Created**: 2025
**Color Scheme**: NIIT University Inspired
**Status**: Fully Functional
