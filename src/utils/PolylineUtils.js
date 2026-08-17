/**
 * Stateless helpers for turning a raw GPS lat/lng stream into a Google
 * Encoded Polyline (the same format Strava returns in `map.summary_polyline`).
 */
class PolylineUtils {
  /**
   * Filter out invalid/missing GPS samples and, if there are more than
   * `maxPoints` valid samples, uniformly downsample while always keeping
   * the first and last valid points.
   *
   * A sample is considered valid only if it is a 2-element array of two
   * finite numbers (`[lat, lng]`). Leading samples before satellite fix
   * are commonly `null` and are dropped here.
   *
   * @param {Array} latlngData - raw latlng stream (array of [lat, lng] or invalid entries)
   * @param {number} [maxPoints=150] - maximum number of points to keep
   * @returns {Array<[number, number]>} filtered/downsampled points, or [] if fewer than 2 valid points
   */
  static filterAndDownsampleLatLng(latlngData, maxPoints = 150) {
    if (!Array.isArray(latlngData)) return [];

    const valid = latlngData.filter(entry =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      Number.isFinite(entry[0]) &&
      Number.isFinite(entry[1])
    );

    if (valid.length < 2) return [];
    if (valid.length <= maxPoints || maxPoints < 2) {
      return maxPoints < 2 ? [valid[0], valid[valid.length - 1]] : valid;
    }

    const stride = (valid.length - 1) / (maxPoints - 1);
    const result = [];
    for (let i = 0; i < maxPoints; i++) {
      const idx = Math.round(i * stride);
      result.push(valid[idx]);
    }
    // Rounding can leave the last sample short of the true final index —
    // force it so the last valid point is always included.
    result[result.length - 1] = valid[valid.length - 1];

    return result;
  }

  /**
   * Encode an array of [lat, lng] points using the Google Encoded Polyline
   * Algorithm (precision 5), the same format used by Strava's `summary_polyline`.
   *
   * @param {Array<[number, number]>} points
   * @returns {string} encoded polyline, or '' if there are fewer than 2 points
   */
  static encodePolyline(points) {
    if (!Array.isArray(points) || points.length === 0) return '';

    let output = '';
    let prevLat = 0;
    let prevLng = 0;

    for (const point of points) {
      const [lat, lng] = point;
      const latE5 = Math.round(lat * 1e5);
      const lngE5 = Math.round(lng * 1e5);

      output += PolylineUtils._encodeSignedNumber(latE5 - prevLat);
      output += PolylineUtils._encodeSignedNumber(lngE5 - prevLng);

      prevLat = latE5;
      prevLng = lngE5;
    }

    return output;
  }

  static _encodeSignedNumber(num) {
    let sgnNum = num << 1;
    if (num < 0) sgnNum = ~sgnNum;
    return PolylineUtils._encodeNumber(sgnNum);
  }

  static _encodeNumber(num) {
    let encoded = '';
    while (num >= 0x20) {
      encoded += String.fromCharCode((0x20 | (num & 0x1f)) + 63);
      num >>= 5;
    }
    encoded += String.fromCharCode(num + 63);
    return encoded;
  }
}

module.exports = PolylineUtils;
