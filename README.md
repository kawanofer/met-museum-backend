# Met Museum Backend API

A Node.js Express backend server that provides a clean API interface to the Metropolitan Museum of Art's public collection API. Features built-in caching, rate limiting, and comprehensive artwork search capabilities.

## Prerequisites

- Node.js (version 2 or higher)
- npm or yarn package manager

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd Backend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory:
```env
MET_API_BASE_URL=https://collectionapi.metmuseum.org
PORT=3001
```

4. Start the server:
```bash
npm start
```

The server will start running on `http://localhost:3001`

## Features

- 🎨 **Artwork Search**: Search for artworks with images, by artist, or by department
- 🏛️ **Department Listings**: Get all available museum departments  
- 📦 **Smart Caching**: 1-hour TTL cache to reduce API calls and improve performance
- 🚦 **Rate Limiting**: Built-in queue system to respect Met Museum API limits (70 req/sec, 5 concurrent)
- 🌐 **CORS Enabled**: Ready for frontend integration
- 🛡️ **Error Handling**: Comprehensive error handling with meaningful responses

## API Endpoints

### 1. Search Artworks with Images
```
GET /api/artworks/search/images?q=painting
```
Returns an array of object IDs for artworks that have images.

**Query Parameters:**
- `q` (optional): Search query (default: "painting")

### 2. Get Artwork Details
```
GET /api/artworks/:objectID
```
Returns detailed information about a specific artwork.

**Parameters:**
- `objectID` (required): The Met Museum object ID

### 3. Search by Artist/Culture
```
GET /api/artworks/search/artist?q=van gogh
```
Returns detailed artwork information for works by a specific artist or culture.

**Query Parameters:**
- `q` (required): Artist name or culture

### 4. List Departments
```
GET /api/departments
```
Returns all available museum departments.

### 5. Search by Department
```
GET /api/artworks/search/department?departmentId=11&q=portrait
```
Returns detailed artwork information from a specific department.

**Query Parameters:**
- `departmentId` (required): Department ID
- `q` (required): Search query

## Technical Details

### Caching Strategy
- Uses `node-cache` with a 1-hour TTL (Time To Live)
- Reduces API calls to the Met Museum API
- Improves response times for repeated requests

### Rate Limiting
- Implements `p-queue` for request management
- Limits to 70 requests per second (below Met Museum's ~80 req/sec limit)
- Maximum 5 concurrent requests to prevent API overload

### Error Handling
- Graceful handling of Met Museum API errors
- Rate limit detection (403 errors)
- Detailed error logging for debugging
- Consistent error response format

## Dependencies

- **express**: Web framework for Node.js
- **axios**: HTTP client for API requests
- **cors**: Cross-Origin Resource Sharing middleware
- **dotenv**: Environment variable management
- **node-cache**: In-memory caching solution
- **p-queue**: Promise queue with rate limiting

## Development

### Environment Variables
- `MET_API_BASE_URL`: Base URL for Met Museum API (default: https://collectionapi.metmuseum.org)
- `PORT`: Server port (default: 3001)

## Acknowledgments

- [Metropolitan Museum of Art](https://www.metmuseum.org/) for providing the public API