package db

import (
	"fmt"
	"log"
	"os"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type Receipt struct {
	gorm.Model
	FileName string
	FileURI  string
}

var DB *gorm.DB

func Connect() {
	var err error

	dbHost := os.Getenv("POSTGRES_HOST")
	if dbHost == "" {
		dbHost = "postgres"
	}

	dbUser := os.Getenv("POSTGRES_USER")
	if dbUser == "" {
		dbUser = "user"
	}

	dbPass := os.Getenv("POSTGRES_PASS")
	if dbPass == "" {
		dbPass = "pass"
	}

	dbName := os.Getenv("POSTGRES_DB")
	if dbName == "" {
		dbName = "reflex-tech-bookkeeping-app-postgres-db"
	}

	dbPort := os.Getenv("POSTGRES_PORT")
	if dbPort == "" {
		dbPort = "5432"
	}

	dsn := fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=disable TimeZone=UTC", dbHost, dbUser, dbPass, dbName, dbPort)

	DB, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatal("Failed to connect to database.", err)
	}

	DB.AutoMigrate(&Receipt{})
}
