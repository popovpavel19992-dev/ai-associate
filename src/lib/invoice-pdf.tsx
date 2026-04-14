// src/lib/invoice-pdf.tsx
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { formatCents } from "@/lib/billing";

interface InvoicePdfProps {
  invoice: {
    invoiceNumber: string;
    issuedDate: string | null;
    dueDate: string | null;
    notes: string | null;
    paymentTerms: string | null;
    subtotalCents: number;
    taxCents: number;
    totalCents: number;
  };
  client: {
    displayName: string;
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    country: string | null;
  };
  firm: {
    name: string;
    addressLine1?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
  };
  lineItems: Array<{
    caseTitle: string;
    type: string;
    description: string;
    quantity: string;
    unitPriceCents: number;
    amountCents: number;
  }>;
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 40,
    paddingBottom: 60,
    paddingHorizontal: 50,
    color: "#1a1a1a",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 32,
  },
  firmName: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: "#1a1a1a",
    marginBottom: 4,
  },
  firmAddress: {
    fontSize: 9,
    color: "#666666",
    lineHeight: 1.5,
  },
  invoiceMeta: {
    textAlign: "right",
  },
  invoiceTitle: {
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 3,
  },
  metaLabel: {
    fontSize: 9,
    color: "#666666",
    width: 70,
    textAlign: "right",
    marginRight: 8,
  },
  metaValue: {
    fontSize: 9,
    color: "#1a1a1a",
    width: 90,
    textAlign: "right",
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    marginBottom: 20,
  },
  billToSection: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  clientName: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#1a1a1a",
    marginBottom: 3,
  },
  clientAddress: {
    fontSize: 9,
    color: "#374151",
    lineHeight: 1.5,
  },
  table: {
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 3,
    marginBottom: 2,
  },
  tableRow: {
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  tableRowAlt: {
    backgroundColor: "#fafafa",
  },
  colDescription: {
    flex: 1,
  },
  colQty: {
    width: 50,
    textAlign: "right",
  },
  colRate: {
    width: 70,
    textAlign: "right",
  },
  colAmount: {
    width: 80,
    textAlign: "right",
  },
  tableHeaderText: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#374151",
    textTransform: "uppercase",
  },
  tableCellText: {
    fontSize: 9,
    color: "#1a1a1a",
    lineHeight: 1.4,
  },
  tableCellSubtext: {
    fontSize: 8,
    color: "#6b7280",
    marginTop: 2,
  },
  totalsSection: {
    alignItems: "flex-end",
    marginTop: 8,
    marginBottom: 24,
  },
  totalsRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  totalsLabel: {
    fontSize: 9,
    color: "#6b7280",
    width: 100,
    textAlign: "right",
    marginRight: 16,
  },
  totalsValue: {
    fontSize: 9,
    color: "#1a1a1a",
    width: 90,
    textAlign: "right",
  },
  totalDivider: {
    width: 206,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    marginBottom: 6,
    marginTop: 2,
  },
  totalRow: {
    flexDirection: "row",
  },
  totalLabel: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#1a1a1a",
    width: 100,
    textAlign: "right",
    marginRight: 16,
  },
  totalValue: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#1a1a1a",
    width: 90,
    textAlign: "right",
  },
  footer: {
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 16,
  },
  footerSectionLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  footerText: {
    fontSize: 9,
    color: "#374151",
    lineHeight: 1.5,
    marginBottom: 12,
  },
});

function formatClientAddress(client: InvoicePdfProps["client"]): string {
  const parts: string[] = [];
  if (client.addressLine1) parts.push(client.addressLine1);
  const cityLine = [client.city, client.state, client.zipCode].filter(Boolean).join(", ");
  if (cityLine) parts.push(cityLine);
  if (client.country && client.country !== "US") parts.push(client.country);
  return parts.join("\n");
}

function formatFirmAddress(firm: InvoicePdfProps["firm"]): string {
  const parts: string[] = [];
  if (firm.addressLine1) parts.push(firm.addressLine1);
  const cityLine = [firm.city, firm.state, firm.zipCode].filter(Boolean).join(", ");
  if (cityLine) parts.push(cityLine);
  return parts.join("\n");
}

export function InvoicePdf({ invoice, client, firm, lineItems }: InvoicePdfProps) {
  const firmAddress = formatFirmAddress(firm);
  const clientAddress = formatClientAddress(client);

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          {/* Firm info */}
          <View>
            <Text style={styles.firmName}>{firm.name}</Text>
            {firmAddress ? <Text style={styles.firmAddress}>{firmAddress}</Text> : null}
          </View>

          {/* Invoice meta */}
          <View style={styles.invoiceMeta}>
            <Text style={styles.invoiceTitle}>INVOICE</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Invoice #</Text>
              <Text style={styles.metaValue}>{invoice.invoiceNumber}</Text>
            </View>
            {invoice.issuedDate ? (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Date</Text>
                <Text style={styles.metaValue}>{invoice.issuedDate}</Text>
              </View>
            ) : null}
            {invoice.dueDate ? (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Due Date</Text>
                <Text style={styles.metaValue}>{invoice.dueDate}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.divider} />

        {/* Bill To */}
        <View style={styles.billToSection}>
          <Text style={styles.sectionLabel}>Bill To</Text>
          <Text style={styles.clientName}>{client.displayName}</Text>
          {clientAddress ? <Text style={styles.clientAddress}>{clientAddress}</Text> : null}
        </View>

        {/* Line Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <View style={styles.colDescription}>
              <Text style={styles.tableHeaderText}>Description</Text>
            </View>
            <Text style={[styles.colQty, styles.tableHeaderText]}>Qty</Text>
            <Text style={[styles.colRate, styles.tableHeaderText]}>Rate</Text>
            <Text style={[styles.colAmount, styles.tableHeaderText]}>Amount</Text>
          </View>

          {lineItems.map((item, index) => (
            <View
              key={index}
              style={[styles.tableRow, index % 2 === 1 ? styles.tableRowAlt : {}]}
            >
              <View style={styles.colDescription}>
                <Text style={styles.tableCellText}>{item.description}</Text>
                <Text style={styles.tableCellSubtext}>
                  {item.caseTitle} · {item.type === "time" ? "Time" : "Expense"}
                </Text>
              </View>
              <Text style={[styles.colQty, styles.tableCellText]}>{item.quantity}</Text>
              <Text style={[styles.colRate, styles.tableCellText]}>
                {item.type === "time"
                  ? formatCents(item.unitPriceCents) + "/hr"
                  : formatCents(item.unitPriceCents)}
              </Text>
              <Text style={[styles.colAmount, styles.tableCellText]}>
                {formatCents(item.amountCents)}
              </Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totalsSection}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text style={styles.totalsValue}>{formatCents(invoice.subtotalCents)}</Text>
          </View>
          {invoice.taxCents > 0 ? (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Tax</Text>
              <Text style={styles.totalsValue}>{formatCents(invoice.taxCents)}</Text>
            </View>
          ) : null}
          <View style={styles.totalDivider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Due</Text>
            <Text style={styles.totalValue}>{formatCents(invoice.totalCents)}</Text>
          </View>
        </View>

        {/* Footer */}
        {(invoice.paymentTerms || invoice.notes) ? (
          <View style={styles.footer}>
            {invoice.paymentTerms ? (
              <>
                <Text style={styles.footerSectionLabel}>Payment Terms</Text>
                <Text style={styles.footerText}>{invoice.paymentTerms}</Text>
              </>
            ) : null}
            {invoice.notes ? (
              <>
                <Text style={styles.footerSectionLabel}>Notes</Text>
                <Text style={styles.footerText}>{invoice.notes}</Text>
              </>
            ) : null}
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
