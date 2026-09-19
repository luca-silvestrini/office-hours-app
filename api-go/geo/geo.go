// Package geo holds the office location and distance math shared by the Go
// serverless functions. Used by the geolocation check-in function (step 5).
package geo

import (
	"math"
	"os"
	"strconv"
)

// Office coordinates. Configurable constant per the spec; overridable at deploy
// time with the OFFICE_LATITUDE / OFFICE_LONGITUDE environment variables so the
// same build can point at a different office without a code change.
//
// Default below: Newman Hall, UC Berkeley area — replace with the real office.
const (
	defaultOfficeLatitude  = 37.86790
	defaultOfficeLongitude = -122.25548

	// CheckInRadiusMiles is how close the browser's geolocation must be to the
	// office for a geolocation check-in to be accepted.
	CheckInRadiusMiles = 1.0

	earthRadiusMiles = 3958.7613
)

// OfficeLatitude returns the configured office latitude.
func OfficeLatitude() float64 {
	return envFloat("OFFICE_LATITUDE", defaultOfficeLatitude)
}

// OfficeLongitude returns the configured office longitude.
func OfficeLongitude() float64 {
	return envFloat("OFFICE_LONGITUDE", defaultOfficeLongitude)
}

// DistanceMiles returns the great-circle distance in miles between two
// coordinates using the haversine formula.
func DistanceMiles(lat1, lon1, lat2, lon2 float64) float64 {
	phi1 := radians(lat1)
	phi2 := radians(lat2)
	dPhi := radians(lat2 - lat1)
	dLambda := radians(lon2 - lon1)

	a := math.Sin(dPhi/2)*math.Sin(dPhi/2) +
		math.Cos(phi1)*math.Cos(phi2)*math.Sin(dLambda/2)*math.Sin(dLambda/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return earthRadiusMiles * c
}

// WithinOfficeRadius reports whether the given coordinates are within
// CheckInRadiusMiles of the configured office, and the computed distance.
func WithinOfficeRadius(lat, lon float64) (ok bool, distanceMiles float64) {
	distanceMiles = DistanceMiles(lat, lon, OfficeLatitude(), OfficeLongitude())
	return distanceMiles <= CheckInRadiusMiles, distanceMiles
}

func radians(deg float64) float64 { return deg * math.Pi / 180 }

func envFloat(key string, fallback float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return fallback
}
