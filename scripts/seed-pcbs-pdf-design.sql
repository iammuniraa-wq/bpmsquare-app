-- Seed: the PCBS page frame and quotation layout, as DATA for the workspace with slug 'pcbs' (PDF redesign, slice 1).
-- GENERATED from scripts/pcbs-pdf-design.data.ts; scripts/pcbsPdfSeed.test.ts fails if this file drifts from it.
-- Idempotent: running it twice leaves one frame and one layout (the layout is matched by its name and rewritten).
-- Needs no migration: the frame is a key in tenants.config, the layout is a row of standard_quote_templates (0054).
-- It does not create the legal entities. Type the entity details (address, C.R. No., VAT No., and the vendor-number id set to
-- "selected customers") in Settings > Company > Entities, then tick the id on the accounts that should print it.
-- Does nothing when no tenant has the slug 'pcbs'. Run by the owner by hand, on the database that holds that workspace.

do $seed$
declare
  t uuid;
begin
  select id into t from tenants where slug = 'pcbs';
  if t is null then
    raise notice 'No tenant with slug pcbs: nothing seeded.';
    return;
  end if;

  update tenants
     set config = jsonb_set(coalesce(config, '{}'::jsonb), '{pdf_design}', $design${
  "page": {
    "size": "A4",
    "margins_mm": {
      "top": 42,
      "right": 12,
      "bottom": 24,
      "left": 19
    }
  },
  "font": "arial_like",
  "base_pt": 10,
  "colors": {
    "text": "#000000",
    "band": "#7f7f7f",
    "band_text": "#ffffff",
    "sub_band": "#ffd700",
    "table_head": "#dbe5f1",
    "rule": "#7f7f7f"
  },
  "header": {
    "logo": "left",
    "logo_height_mm": 17,
    "lines": [
      "extra_ids"
    ],
    "title_band": true
  },
  "footer": {
    "rule": true,
    "left": [
      "address",
      "cr",
      "vat"
    ],
    "right": [
      "phones",
      "email",
      "web"
    ],
    "page_numbers": true,
    "strip": [
      "#7f7f7f",
      "#ffd700",
      "#7f7f7f"
    ]
  },
  "table": {
    "borders": "grid",
    "zebra": false
  }
}$design$::jsonb, true)
   where id = t;

  update standard_quote_templates set is_default = false where tenant_id = t and name <> 'PCBS quotation' and is_default;

  insert into standard_quote_templates (tenant_id, name, is_default, accent_color, logo_position, blocks)
  values (t, 'PCBS quotation', true, '#7f7f7f', 'left', $blocks$[
  {
    "id": "letterhead",
    "type": "letterhead",
    "visible": true
  },
  {
    "id": "quote_meta",
    "type": "quote_meta",
    "visible": true
  },
  {
    "id": "bill_to",
    "type": "bill_to",
    "visible": true
  },
  {
    "id": "front_block",
    "type": "front_block",
    "visible": true,
    "data": {
      "title": "QUOTATION",
      "reference_label": "RFQ #",
      "rows": [
        {
          "label": "DATE",
          "field": "date"
        },
        {
          "label": "Company",
          "field": "account"
        },
        {
          "label": "Tel./Fax",
          "field": "account_phone"
        },
        {
          "label": "Contact",
          "field": "contact"
        },
        {
          "label": "Mobile",
          "field": "contact_phone",
          "label2": "Email",
          "field2": "contact_email"
        },
        {
          "label": "Project Title",
          "field": "project_title"
        },
        {
          "label": "Subject",
          "field": "subject"
        }
      ],
      "greeting": "Dear Sir,",
      "opening": "We take this opportunity to thank you for your invitation to participate in the above project, please find below our offer, based on the info provided by you."
    }
  },
  {
    "id": "sec-a",
    "type": "clause_section",
    "visible": true,
    "data": {
      "title": "IMPORTANT INFORMATION",
      "numbered": false,
      "items": [
        {
          "id": "a1",
          "text": "This offer based on the current drawings provided by you, PCBS has the right to reassess if the final drawings, specifications, and project requirements have modified from the considered reference in this quotation. (See Clause B1)"
        },
        {
          "id": "a2",
          "text": "PCBS uses ACI, PCI & ASTM for design and execution. The shop drawings will be prepared in accordance with provided original drawings and design criteria. However, it is understood by the client that the above-mentioned codes will apply architecturally and structurally in our products, the tolerances of Production and Erection is as per tolerances of the PCI."
        },
        {
          "id": "a3",
          "text": "If MEP items or any accessories not mentioned and not related directly to PCBS scope. Once required, it shall be supplied to PCBS factory as well as the Clients should marking-up on the hardcopy of fabrication drawings, which will submit to the Client for approval/comments. Besides, we will place the fixation of the mentioned items embedding the precast concrete products free of charge."
        },
        {
          "id": "a4",
          "text": "PCBS highly recommends that any technical requirements and/or oral commitments about the scope of work must be determined here in order to prevent any misunderstanding or suspicion. Hence, all the mentioned points in this quotation will apply during all project stages unless otherwise stated in such further contract agreements."
        },
        {
          "id": "a5",
          "text": "PCBS will provide a warranty certificate for in-house products for 10 years after approval of our completion certificate. This Guarantee only covers the cost of repairing or removing and replacing defective products. The guarantee will remain in effect for Ten Years from above date, and any claim under this guarantee must be notified in writing to Precast Building System Co. Ltd. within that period."
        }
      ]
    }
  },
  {
    "id": "sec-b",
    "type": "clause_section",
    "visible": true,
    "data": {
      "title": "REQUIREMENTS, SPECIFICATIONS AND CRITERIA",
      "numbered": true,
      "items": [
        {
          "id": "b1",
          "text": "Our price is based on the provided drawings.",
          "heading": "LIST OF DRAWINGS:",
          "edit": true
        },
        {
          "id": "b2",
          "text": "PCBS will design the precast elements as per ASTM / ACI / PCI requirements, the shop drawings will be prepared in accordance with provided original drawings and design criteria.",
          "heading": "TECHNICAL INFORMATION:",
          "sub": [
            "Precast Elements will manufacture in accordance with PCBS standard procedures and with due reference to your supplied information and drawings. PCBS reserve the right to change some portion(s) on your drawings whenever necessary depending upon structural design, standard manufacturing and handling, delivery and installation procedures may require. Hence, the sizes of P.C. foundation, P.C. Column, etc. is subject to confirmation by PCBS Engineering Dept.",
            "Acceptability of appearance of the produced elements and the finishing shall be within normally accepted standard as stated in Precast Concrete Institute (MNL116-99 4th Edition, MNL 117-96 3rd Edition).",
            "The precast/prestressed units shall be produced & installed within the dimensional tolerances detailed in Precast Concrete Institute (MNL-120-04 6th Edition, MNL-135-00, MNL116-99 4th Edition, MNL 117-96 3rd Edition).",
            "It's important to realize that the concrete components have made from natural materials, it's normal and most prospect the precast elements to have some surface discoloration, gross color changes, mottled or dark blotches whether are extracted-off-mold or smooth hand trowel finish or even after the final surface finish eg: Sandblasted elements, that will be in conjunction and in accordance with ASTM / PCI / ACI, PCBS products shall not exceeding the accepted tolerance as instructed in the mentioned codes, moreover, any required of surface preparation before paint or color treatment are not included in our scope of works."
          ]
        },
        {
          "id": "b3",
          "text": "Cement: Grey Cement (OPC TYPE I).",
          "heading": "SPECIFICATION OF PRECAST CONCRETE ELEMENTS",
          "edit": true,
          "sub": [
            "Compressive Strength: Cylindrical shall be 35 MPa at 28 days for PC Elements.",
            "Cementitious Materials: The concrete mix will be normal without any special additive.",
            "Finishes will be the following: Grey Cement Smooth as extracted from the molds and steel-troweled finish as per ACI-PCI standard.",
            "Reinforcement: Uncoated deformed carbon steel bars conforming to ASTM A615 with Grade 60."
          ]
        },
        {
          "id": "b4",
          "text": "",
          "heading": "LIST OF P.C. PRODUCTS:",
          "edit": true
        }
      ]
    }
  },
  {
    "id": "sec-c",
    "type": "clause_section",
    "visible": true,
    "data": {
      "title": "SCOPE OF WORK",
      "numbered": true,
      "items": [
        {
          "id": "c1",
          "text": "PCBS offer includes Production only. (Some deviations or more details may be mentioned in Clause D. PRICE / BILL OF QUANTITY.",
          "edit": true
        },
        {
          "id": "c2",
          "text": "",
          "heading": "SCOPE OF WORKS MATRIX:"
        }
      ]
    }
  },
  {
    "id": "mx-eng",
    "type": "scope_matrix",
    "visible": true,
    "data": {
      "title": "ENGINEERING",
      "columns": [
        "BY PCBS",
        "BY CLIENT",
        "N/A"
      ],
      "remark": true,
      "rows": [
        {
          "id": "r1",
          "text": "Prepare the shop drawings"
        },
        {
          "id": "r2",
          "text": "Obtain the client approval of the shop drawings"
        }
      ]
    }
  },
  {
    "id": "mx-prod",
    "type": "scope_matrix",
    "visible": true,
    "data": {
      "title": "PRODUCTION _ SCOPE OF WORK",
      "columns": [
        "BY PCBS",
        "BY CLIENT",
        "N/A"
      ],
      "remark": true,
      "rows": [
        {
          "id": "r1",
          "text": "Manufacture of Precast Elements as per Approved Shop Drawings and relevant documents"
        },
        {
          "id": "r2",
          "text": "Supply and verify of MEP items"
        },
        {
          "id": "r3",
          "text": "Installing the Supplied MEP items as per approved shop drawings"
        },
        {
          "id": "r4",
          "text": "Provide sample for finish surface approval"
        },
        {
          "id": "r5",
          "text": "Bitumen Paint (SIKA TOP 550)"
        },
        {
          "id": "r6",
          "text": "All tests and inspections in-house PCBS Laboratory & Inspection of Products"
        },
        {
          "id": "r7",
          "text": "Testing by third party"
        },
        {
          "id": "r8",
          "text": "Any Anchor bolts, dowels, steel plates embedded, etc.."
        },
        {
          "id": "r9",
          "text": "At factory, Loading the elements on the trailer"
        }
      ]
    }
  },
  {
    "id": "mx-del",
    "type": "scope_matrix",
    "visible": true,
    "data": {
      "title": "DELIVERY _ SCOPE OF WORK",
      "columns": [
        "BY PCBS",
        "BY CLIENT",
        "N/A"
      ],
      "remark": true,
      "rows": [
        {
          "id": "r1",
          "text": "Transport the elements to site"
        },
        {
          "id": "r2",
          "text": "Unloading at site"
        }
      ]
    }
  },
  {
    "id": "mx-ere",
    "type": "scope_matrix",
    "visible": true,
    "data": {
      "title": "ERECTION _ SCOPE OF WORK",
      "columns": [
        "BY PCBS",
        "BY CLIENT",
        "N/A"
      ],
      "remark": true,
      "rows": [
        {
          "id": "r1",
          "text": "Erect the elements as per approved drawings"
        },
        {
          "id": "r2",
          "text": "Grouting and joints"
        }
      ]
    }
  },
  {
    "id": "sec-d",
    "type": "clause_section",
    "visible": true,
    "data": {
      "title": "PRICE / BILL OF QUANTITY",
      "numbered": false,
      "items": [
        {
          "id": "d1",
          "text": "",
          "heading": "EX-FACTORY (PRODUCTION) ONLY",
          "band": true,
          "edit": true
        }
      ]
    }
  },
  {
    "id": "line_items",
    "type": "line_items",
    "visible": true,
    "data": {
      "preset": "boq",
      "total_label": "TOTAL AMOUNT FOR {QTY} {UOM}",
      "note": "NOTE: According to the General Authority of Zakat & Tax, a VAT will be imposed in invoices for the above amounts."
    }
  },
  {
    "id": "totals",
    "type": "totals",
    "visible": true
  },
  {
    "id": "sec-e",
    "type": "clause_section",
    "visible": true,
    "data": {
      "title": "COMMERCIAL TERMS (EXCEPTIONS & DEVIATIONS)",
      "numbered": false,
      "items": [
        {
          "id": "e1",
          "text": "Our offer includes the items described in the Bill of Quantities only; hence, any items not mentioned herein are not included in our price."
        },
        {
          "id": "e2",
          "text": "PCBS offer has prepared based on the drawings and documents provided by you, so, any change or deviation it maybe makes variation cost accordingly."
        },
        {
          "id": "e3",
          "text": "Whereas this commercial offer is integrated part of any prospected agreement, the acknowledgment scope of work has fixed between both organizations contractually; thus, in the event that the client want to reduce the scope of works, the approval of PCBS Co. is mandatory."
        },
        {
          "id": "e4",
          "text": "The offered Rates has provided based on awarding of all figured quantities so, if the actual QTY (based on final design and acceptance method of measurement) was less than 100% from the quotation's BOQ therefore, PCBS has the right escalate the Rates according to cost impact resulting by reducing these quantities."
        },
        {
          "id": "e5",
          "text": "The cost of engineering works has included in our price, it includes if some revisions for the mark-up of MEP as well as if some reasonable adjustment happened. Any changes/cancelation in IFC Drawings after PCBS start preparation of GAD will be subjected to time and cost variation equal to the time invested in engineering works from the schedule start date. As the engineering cost does not anticipate any major changes to the input information on which the design & drawing work is based which may warrant substantial rework. Hence, in case of any such rework, it is right to PCBS to charge a design variation order accordingly. Further, the engineering Man-Hour rate is (410 SAR/Hr). (Also, See Clause G. Program, how the Timeline may be impacted!)."
        },
        {
          "id": "e6",
          "text": "Some Moulds will be fabricating particularly on the tables of PCBS plant in order to manufacture your precast elements such as required, the cost of these Moulds has included in our Price. But, in case the design has been adjusted after Moulds fabrication or if the production has been suspended or canceled hence, it is right to PCBS to charge the cost of fabricating the moulds and the reservation of the mentioned tables without running of production. (Also, see Clause G. PROGRAM how the timeline may be impacted!)."
        },
        {
          "id": "e7",
          "text": "In event that the Client delayed PCBS trailer to turnaround more than 2 hour, the time above this will be subject to a demurrage-charge of SAR 100 per hour or part of this time."
        },
        {
          "id": "e8",
          "text": "Timbers (woods) used for protection of P.C. during the transportation, which retained by the client on-site, it will be right to PCBS to charge an extra-cost (not before the Client has properly notified to avoid retained it)."
        },
        {
          "id": "e9",
          "text": "PCBS will coordinate (in advance) with the Client regarding the time of delivery and erection, Hence, if the client failed (for any reason related to his scope) to receive the elements and doing his obligation which resulting to return the batch (loads) to PCBS factory, in this case, the direct and indirect cost will be charged accordingly."
        },
        {
          "id": "e10",
          "text": "In the event, that client has a failure in his obligation at the site to receive precast elements: An additional 3% of the rates will charge for every week for produced precast elements that stored at PCBS stockyard will be imposed after stocked more than twenty-one (21) days."
        },
        {
          "id": "e11",
          "text": "This quotation is based on the current price only. Due to continuous increase of the major construction raw-materials price (such as Sand & Coarse aggregates, Cement, Reinforcement Bars / Wire Meshes, Pre-stressed Strands, Diesel/ Steel/ Timber moulds, Accessories/ fixing and Inserts in the PC elements, Transportation and Crane), any increase of the base prices (with a proof via letters from suppliers, Purchase Orders, etc.) greater than 5% we would be submitted and subsequently would be added to the value of this quotation for the affected activity or activities."
        },
        {
          "id": "e12",
          "text": "Steel Reinforcement (Uncoated): 10mm: SAR 3,100/Ton; 12-32mm: SAR 2,900/Ton.",
          "heading": "Key Materials Base Rates:",
          "edit": true
        },
        {
          "id": "e13",
          "text": "The quantities are approximately estimated, however, it should be re-measuring upon receipt of final approved drawings.",
          "heading": "Method of Measurement:"
        },
        {
          "id": "e14",
          "text": "N/A",
          "heading": "Remarks for the Lift Equipment:",
          "edit": true
        }
      ]
    }
  },
  {
    "id": "sec-f",
    "type": "clause_section",
    "visible": true,
    "data": {
      "title": "PAYMENT TERMS",
      "numbered": true,
      "items": [
        {
          "id": "f1",
          "text": "50% Advance Payment upon signing of the contract.",
          "heading": "ADVANCE",
          "edit": true
        },
        {
          "id": "f2",
          "text": "50% for Upon Production before delivery, Progress invoices payable in seven days from the date of invoice.",
          "heading": "PROGRESS INVOICE",
          "edit": true
        }
      ]
    }
  },
  {
    "id": "sec-g",
    "type": "clause_section",
    "visible": true,
    "data": {
      "title": "DURATION",
      "numbered": false,
      "items": [
        {
          "id": "g1",
          "text": "The Job will be complete as per the agreed program and subject to the following:",
          "sub": [
            "Releasing all due payment as mentioned in F1 above.",
            "Site readiness including access, with no restriction for moving products, equipment, etc.",
            "Maintain the Client obligations and responsibilities and any suspensions of the production may consider into account.",
            "The project schedule and duration will be determined based on allocation and release sequence of the villas."
          ]
        }
      ]
    }
  },
  {
    "id": "sec-h",
    "type": "clause_section",
    "visible": true,
    "data": {
      "title": "VALIDITY",
      "numbered": false,
      "items": [
        {
          "id": "h1",
          "text": "Our offer is valid for 20 days from the date of this quotation."
        }
      ]
    }
  },
  {
    "id": "closing",
    "type": "closing",
    "visible": true,
    "data": {
      "text": "We trust our offer is of interest and a demonstration of our commitment to support you on this particular project. Should you wish to discuss any aspect of this offer please don't hesitate to contact us on Tel: +966 13 820 7470 Ext: 103; or email us on sales@pcbs.com.sa.",
      "regards": "BEST REGARDS,",
      "signatory_title": "Chief Executive Officer"
    }
  }
]$blocks$::jsonb)
  on conflict (tenant_id, name) do update
     set blocks = excluded.blocks, accent_color = excluded.accent_color, logo_position = excluded.logo_position,
         is_default = true, updated_at = now();
end
$seed$;
