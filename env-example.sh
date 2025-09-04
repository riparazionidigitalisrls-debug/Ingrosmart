# IngroSmart Configuration
INGRO_BASE_URL=https://www.ingrosmart.it
INGRO_LOGIN_URL=https://www.ingrosmart.it/customer/account/login/
INGRO_EXPORT_URL=https://www.ingrosmart.it/datacomcontroller/agent/productExport/
INGRO_USER=info@riparazionidigitali.it
INGRO_PASS=Carlo5454

# Target: wp | s3 | fs
TARGET=fs

# General Settings
KEEP_HISTORY=10
LOG_LEVEL=info

# WordPress Configuration (if TARGET=wp)
WP_BASE_URL=http://ricondizionati.shop
WP_USER=riparazionidigitali.srls@gmail.com
WP_APP_PASS=Carlo19791979!!
WP_UPLOAD_PATH=/wp-content/uploads/ingrosmart/
WP_DEST_FILE=ingrosmart_catalog.csv

# S3/B2 Configuration (if TARGET=s3)
S3_ENDPOINT=https://s3.eu-central-003.backblazeb2.com
S3_REGION=eu-central-003
S3_BUCKET=your-bucket-name
S3_ACCESS_KEY=your_access_key
S3_SECRET_KEY=your_secret_key
S3_KEY_PREFIX=ingrosmart/ingrosmart_catalog.csv
S3_KEY_PREFIX_HISTORY=ingrosmart/history/
