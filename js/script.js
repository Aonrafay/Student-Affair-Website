// ===== Navigation Toggle =====
function setupNavigation() {
  const navToggle = document.querySelector('.nav-toggle');
  const navMenu = document.querySelector('nav ul');

  if (navToggle) {
    navToggle.addEventListener('click', () => {
      navMenu.classList.toggle('active');
    });

    // Close menu when link is clicked
    document.querySelectorAll('nav a').forEach(link => {
      link.addEventListener('click', () => {
        navMenu.classList.remove('active');
      });
    });
  }
}

// ===== Modal/Popup Functions =====
function showModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('show');
    document.body.classList.add('no-scroll');
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('show');
    document.body.classList.remove('no-scroll');
  }
}

// ===== Countdown Timer =====
function updateCountdown(eventDate, countdownElementId) {
  const countdownElement = document.getElementById(countdownElementId);
  if (!countdownElement) return;

  const updateTimer = () => {
    const now = new Date().getTime();
    const distance = new Date(eventDate).getTime() - now;

    if (distance < 0) {
      countdownElement.innerHTML = '<div class="countdown-item"><p>Event Already Passed</p></div>';
      return;
    }

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    countdownElement.innerHTML = `
      <div class="countdown-item">
        <div class="countdown-value">${days}</div>
        <div class="countdown-label">Days</div>
      </div>
      <div class="countdown-item">
        <div class="countdown-value">${hours}</div>
        <div class="countdown-label">Hours</div>
      </div>
      <div class="countdown-item">
        <div class="countdown-value">${minutes}</div>
        <div class="countdown-label">Minutes</div>
      </div>
      <div class="countdown-item">
        <div class="countdown-value">${seconds}</div>
        <div class="countdown-label">Seconds</div>
      </div>
    `;
  };

  updateTimer();
  setInterval(updateTimer, 1000);
}

// ===== Slider/Carousel Functions =====
class Slider {
  constructor(sliderId) {
    this.slider = document.getElementById(sliderId);
    this.slides = this.slider.querySelectorAll('.slide');
    this.dots = document.querySelectorAll(`#${sliderId} ~ .slide-control .slide-dot`);
    this.prevBtn = document.querySelector(`button.prev[data-slider="${sliderId}"]`);
    this.nextBtn = document.querySelector(`button.next[data-slider="${sliderId}"]`);
    this.currentIndex = 0;
    this.autoPlayInterval = null;

    this.init();
  }

  init() {
    if (this.prevBtn) this.prevBtn.addEventListener('click', () => this.prev());
    if (this.nextBtn) this.nextBtn.addEventListener('click', () => this.next());

    this.dots.forEach((dot, index) => {
      dot.addEventListener('click', () => this.goToSlide(index));
    });

    this.updateSlider();
    this.startAutoPlay();
  }

  prev() {
    this.currentIndex = (this.currentIndex - 1 + this.slides.length) % this.slides.length;
    this.updateSlider();
    this.resetAutoPlay();
  }

  next() {
    this.currentIndex = (this.currentIndex + 1) % this.slides.length;
    this.updateSlider();
    this.resetAutoPlay();
  }

  goToSlide(index) {
    this.currentIndex = index;
    this.updateSlider();
    this.resetAutoPlay();
  }

  updateSlider() {
    const offset = -this.currentIndex * 100;
    this.slider.style.transform = `translateX(${offset}%)`;

    this.dots.forEach((dot, index) => {
      dot.classList.toggle('active', index === this.currentIndex);
    });
  }

  startAutoPlay() {
    this.autoPlayInterval = setInterval(() => this.next(), 5000);
  }

  resetAutoPlay() {
    clearInterval(this.autoPlayInterval);
    this.startAutoPlay();
  }
}

// ===== Tab Functions =====
function setupTabs(tabContainerId) {
  const container = document.getElementById(tabContainerId);
  if (!container) return;

  const tabs = container.querySelectorAll('.tab-btn');
  const contents = container.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-tab');

      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(targetId)?.classList.add('active');
    });
  });

  // Activate first tab by default
  if (tabs.length > 0) {
    tabs[0].click();
  }
}

// ===== Modal Close on Outside Click =====
function setupModalCloseOnOutsideClick() {
  const modals = document.querySelectorAll('.modal');
  modals.forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal(modal.id);
      }
    });

    const closeBtn = modal.querySelector('.modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => closeModal(modal.id));
    }
  });
}

// ===== Smooth Scroll for Anchor Links =====
function setupSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href !== '#' && document.querySelector(href)) {
        e.preventDefault();
        document.querySelector(href).scrollIntoView({
          behavior: 'smooth'
        });
      }
    });
  });
}

// ===== Lazy Loading Images =====
function setupLazyLoading() {
  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
          }
          observer.unobserve(img);
        }
      });
    });

    document.querySelectorAll('img[data-src]').forEach(img => {
      imageObserver.observe(img);
    });
  }
}

// ===== Popup on Page Load (For Upcoming Events) =====
function showUpcomingEventsPopup() {
  // Show popup after 2 seconds with a slight delay for better UX
  setTimeout(() => {
    const popup = document.getElementById('eventPopup');
    if (popup) {
      showModal('eventPopup');
    }
  }, 1000);
}

// ===== Prevent Multiple Modal Opens =====
function setupModalButtons() {
  document.querySelectorAll('[data-modal]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const modalId = btn.getAttribute('data-modal');
      showModal(modalId);
    });
  });
}

// ===== Active Navigation Highlighting =====
function highlightActiveNavLink() {
  const currentLocation = location.pathname;
  const navLinks = document.querySelectorAll('nav a');

  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href && currentLocation.includes(href) && href !== '/') {
      link.style.borderBottomColor = 'var(--accent-gold)';
      link.style.color = 'var(--accent-gold)';
    }
  });
}

// ===== Initialize All Features =====
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupModalCloseOnOutsideClick();
  setupSmoothScroll();
  setupLazyLoading();
  setupModalButtons();
  highlightActiveNavLink();
  showUpcomingEventsPopup();

  // Initialize sliders (if present on page)
  const sliderIds = ['ambassadorsSlider', 'partnersSlider'];
  sliderIds.forEach(id => {
    if (document.getElementById(id)) {
      new Slider(id);
    }
  });

  // Initialize tabs (if present on page)
  const tabContainerIds = ['eventTabs'];
  tabContainerIds.forEach(id => {
    if (document.getElementById(id)) {
      setupTabs(id);
    }
  });
});

// ===== Utility: Format Date =====
function formatDate(dateString) {
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return new Date(dateString).toLocaleDateString('en-US', options);
}

// ===== Search/Filter Function =====
function filterItems(searchInputId, itemsSelector) {
  const searchInput = document.getElementById(searchInputId);
  if (!searchInput) return;

  searchInput.addEventListener('keyup', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const items = document.querySelectorAll(itemsSelector);

    items.forEach(item => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(searchTerm) ? 'block' : 'none';
    });
  });
}

// ===== Print Function (for certificates, event details, etc.) =====
function printPage() {
  window.print();
}

// ===== Copy to Clipboard =====
function copyToClipboard(text, feedbackId) {
  navigator.clipboard.writeText(text).then(() => {
    const feedback = document.getElementById(feedbackId);
    if (feedback) {
      feedback.textContent = 'Copied!';
      setTimeout(() => {
        feedback.textContent = '';
      }, 2000);
    }
  });
}

// ===== Export as PDF (requires external library like jsPDF) =====
function exportAsPDF(elementId, fileName) {
  const element = document.getElementById(elementId);
  if (!element) return;
  // This would require jsPDF library
  // Implementation depends on selected PDF library
  console.log('Exporting to PDF:', fileName);
}

// ===== Debounce Function (for scroll/resize events) =====
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ===== Intersection Observer for Animations =====
function setupScrollAnimations() {
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -100px 0px'
  };

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.animation = 'fadeInUp 0.6s ease-out forwards';
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll('.card, .event-item, .society-card').forEach(el => {
    observer.observe(el);
  });
}

// Add scroll animations on page load
window.addEventListener('load', setupScrollAnimations);
