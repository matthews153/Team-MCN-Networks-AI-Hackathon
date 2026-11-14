import tkinter as tk


def main() -> None:
    root = tk.Tk()
    root.title("White Screen")
    root.configure(bg="white")
    root.geometry("800x600")
    root.attributes("-fullscreen", True)
    root.bind("<Escape>", lambda event: root.destroy())
    root.mainloop()


if __name__ == "__main__":
    main()
