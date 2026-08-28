CREATE DATABASE IF NOT EXISTS student_affairs;
USE student_affairs;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'user') DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS societies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    president_name VARCHAR(100),
    vice_president_name VARCHAR(100),
    member_count INT DEFAULT 0,
    icon_class VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    event_date DATETIME,
    event_type ENUM('upcoming', 'past') DEFAULT 'upcoming',
    location VARCHAR(200),
    image_url VARCHAR(255),
    winners_details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ambassadors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    university VARCHAR(150),
    position VARCHAR(100),
    bio TEXT,
    image_url VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS partners (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    category ENUM('platinum', 'diamond', 'gold') NOT NULL,
    description TEXT,
    logo_url VARCHAR(255),
    website_url VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert a default admin user (password is 'admin123')
-- MAKE SURE TO CHANGE THIS IN PRODUCTION
INSERT INTO users (username, email, password_hash, role) 
VALUES ('admin', 'admin@university.edu', '$2b$10$YourHashedPasswordHerePleaseGenerateAdmin123', 'admin')
ON DUPLICATE KEY UPDATE id=id;
