"""1D ResNet for 12-lead ECG multi-label classification."""
from __future__ import annotations

import torch
import torch.nn as nn


class ResBlock1d(nn.Module):
    def __init__(self, c_in: int, c_out: int, stride: int, k: int = 9, dropout: float = 0.1):
        super().__init__()
        p = k // 2
        self.conv1 = nn.Conv1d(c_in, c_out, k, stride=stride, padding=p, bias=False)
        self.bn1 = nn.BatchNorm1d(c_out)
        self.conv2 = nn.Conv1d(c_out, c_out, k, padding=p, bias=False)
        self.bn2 = nn.BatchNorm1d(c_out)
        self.drop = nn.Dropout(dropout)
        self.act = nn.ReLU(inplace=True)
        self.skip = None
        if stride != 1 or c_in != c_out:
            self.skip = nn.Sequential(
                nn.AvgPool1d(stride, stride, ceil_mode=True) if stride > 1 else nn.Identity(),
                nn.Conv1d(c_in, c_out, 1, bias=False),
                nn.BatchNorm1d(c_out),
            )

    def forward(self, x):
        idt = x if self.skip is None else self.skip(x)
        out = self.act(self.bn1(self.conv1(x)))
        out = self.drop(out)
        out = self.bn2(self.conv2(out))
        if out.shape[-1] != idt.shape[-1]:
            idt = idt[..., : out.shape[-1]]
        return self.act(out + idt)


class ResNet1d(nn.Module):
    """Input (B, 12, T) -> logits (B, n_classes)."""

    def __init__(self, n_leads: int = 12, n_classes: int = 5,
                 widths=(64, 128, 192, 256), blocks=(2, 2, 2, 2), dropout: float = 0.1):
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv1d(n_leads, widths[0], 15, stride=2, padding=7, bias=False),
            nn.BatchNorm1d(widths[0]),
            nn.ReLU(inplace=True),
        )
        layers = []
        c = widths[0]
        for i, (w, b) in enumerate(zip(widths, blocks)):
            for j in range(b):
                stride = 2 if (j == 0 and i > 0) else 1
                layers.append(ResBlock1d(c, w, stride, dropout=dropout))
                c = w
        self.body = nn.Sequential(*layers)
        self.head = nn.Sequential(
            nn.Dropout(0.3),
            nn.Linear(2 * c, n_classes),
        )

    def forward(self, x):
        h = self.body(self.stem(x))
        h = torch.cat([h.mean(-1), h.amax(-1)], dim=1)
        return self.head(h)
