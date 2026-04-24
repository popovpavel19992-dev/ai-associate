import { Document, Page, Image, StyleSheet, View } from "@react-pdf/renderer";
import * as React from "react";

const styles = StyleSheet.create({
  page: { padding: 20 },
  image: { width: "100%", height: "100%", objectFit: "contain" },
  container: { flex: 1 },
});

export function ImageWrapper({ src }: { src: string }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.container}>
          <Image src={src} style={styles.image} />
        </View>
      </Page>
    </Document>
  );
}
