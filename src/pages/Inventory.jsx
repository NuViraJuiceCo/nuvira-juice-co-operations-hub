import { useState, useEffect } from "react";
import { Package, AlertTriangle, TrendingDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatCard from "../components/shared/StatCard";

const mockInventory = [
  { id: 1, ingredient: "Kale", unit: "kg", stock: 12, reorder: 10, status: "OK", supplier: "Fresh Farms" },
  { id: 2, ingredient: "Blueberries", unit: "kg", stock: 3, reorder: 8, status: "Low", supplier: "Fresh Farms" },
  { id: 3, ingredient: "Ginger", unit: "kg", stock: 5, reorder: 3, status: "OK", supplier: "Local Market" },
  { id: 4, ingredient: "Cucumber", unit: "kg", stock: 18, reorder: 10, status: "OK", supplier: "Local Market" },
  { id: 5, ingredient: "Pineapple", unit: "kg", stock: 1, reorder: 5, status: "Critical", supplier: "Tropical Imports" },
  { id: 6, ingredient: "Apple Juice Base", unit: "L", stock: 40, reorder: 20, status: "OK", supplier: "AgroCo" },
  { id: 7, ingredient: "Celery", unit: "kg", stock: 7, reorder: 8, status: "Low", supplier: "Local Market" },
  { id: 8, ingredient: "Lemon", unit: "kg", stock: 15, reorder: 10, status: "OK", supplier: "Citrus Co" },
  { id: 9, ingredient: "Spinach", unit: "kg", stock: 9, reorder: 8, status: "OK", supplier: "Fresh Farms" },
  { id: 10, ingredient: "Turmeric", unit: "g", stock: 500, reorder: 200, status: "OK", supplier: "Spice World" },
];

const statusStyle = {
  OK: "bg-emerald-50 text-emerald-700",
  Low: "bg-amber-50 text-amber-700",
  Critical: "bg-red-50 text-red-700",
};

export default function Inventory() {
  const low = mockInventory.filter((i) => i.status === "Low").length;
  const critical = mockInventory.filter((i) => i.status === "Critical").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Inventory</h1>
          <p className="text-muted-foreground mt-1">Track ingredient stock levels and reorder points</p>
        </div>
        <Button className="gap-2"><Plus className="h-4 w-4" /> Add Item</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Items" value={mockInventory.length} icon={Package} />
        <StatCard label="Low Stock" value={low} icon={TrendingDown} />
        <StatCard label="Critical" value={critical} icon={AlertTriangle} />
        <StatCard label="Suppliers" value={4} icon={Package} />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Ingredient", "Stock", "Unit", "Reorder At", "Status", "Supplier"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mockInventory.map((item) => (
                <tr key={item.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-sm text-foreground">{item.ingredient}</td>
                  <td className="px-5 py-3.5 text-sm text-foreground font-semibold">{item.stock}</td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{item.unit}</td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{item.reorder}</td>
                  <td className="px-5 py-3.5">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle[item.status]}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{item.supplier}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}