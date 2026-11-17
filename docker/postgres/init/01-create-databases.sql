-- Creates per-service databases on first initialization of the local Postgres volume.
-- Each service owns its database; no shared database across services.
CREATE DATABASE catalog_db;
CREATE DATABASE cart_db;
