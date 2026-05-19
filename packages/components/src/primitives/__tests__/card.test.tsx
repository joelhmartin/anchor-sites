import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "../card.js";

describe("Card", () => {
  it("renders the full composition", () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Desc</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Foot</CardFooter>
      </Card>,
    );

    expect(screen.getByTestId("card")).toBeInTheDocument();
    expect(screen.getByText("Title").tagName).toBe("H3");
    expect(screen.getByText("Desc").tagName).toBe("P");
    expect(screen.getByText("Body")).toBeInTheDocument();
    expect(screen.getByText("Foot")).toBeInTheDocument();
  });

  it("applies brand-token surface classes on the root", () => {
    render(<Card data-testid="card">x</Card>);
    expect(screen.getByTestId("card").className).toMatch(/bg-theme-surface/);
  });
});
