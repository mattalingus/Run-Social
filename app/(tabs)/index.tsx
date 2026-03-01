import React, { useEffect, useState } from "react";
import { View, StyleSheet, Dimensions, ActivityIndicator } from "react-native";
import MapView, { Marker, Region } from "react-native-maps";
import * as Location from "expo-location";

const { width, height } = Dimensions.get("window");

export default function MapScreen() {
  const [region, setRegion] = useState<Region | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        // Fallback to Houston
        setRegion({
          latitude: 29.7604,
          longitude: -95.3698,
          latitudeDelta: 0.08,
          longitudeDelta: 0.08,
        });
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      setRegion({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      });
    })();
  }, []);

  if (!region) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#00ff99" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView style={styles.map} region={region}>
        {/* Temporary Test Markers */}
        <Marker
          coordinate={{
            latitude: region.latitude + 0.01,
            longitude: region.longitude + 0.01,
          }}
          title="Morning Run"
        />
        <Marker
          coordinate={{
            latitude: region.latitude - 0.01,
            longitude: region.longitude - 0.01,
          }}
          title="Evening Tempo"
        />
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    width,
    height,
  },
  loader: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000",
  },
});
