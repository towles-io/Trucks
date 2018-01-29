import {Component, OnInit} from '@angular/core';
import {AngularFirestore, AngularFirestoreCollection, AngularFirestoreDocument} from 'angularfire2/firestore';
import {Equipment} from '../../../shared/model/equipment.model';
import {FormBuilder, FormGroup} from '@angular/forms';
import {ActivatedRoute, Params, Router} from '@angular/router';
import {Observable} from 'rxjs/Observable';
import {EquipmentImage, EquipmentImageId} from '../../../shared/model/equipment-image.model';
import {FileUploader, FileUploaderOptions, ParsedResponseHeaders} from 'ng2-file-upload';
import {Cloudinary} from '@cloudinary/angular-5.x';
import {HttpClient} from '@angular/common/http';
import {InventoryService} from '../../../core/inventory.service';
import {ToastrService} from 'ngx-toastr';
import {EquipmentOption} from '../../../shared/model/equipment-option.model';

@Component({
  selector: 'app-inventory-edit',
  templateUrl: './inventory-edit.component.html',
  styleUrls: ['./inventory-edit.component.scss']
})

export class InventoryEditComponent implements OnInit {
  private itemDoc: AngularFirestoreDocument<Equipment>;
  item: Equipment;
  name: string;
  private itemOptionsCollection: AngularFirestoreCollection<EquipmentOption>;

  private imageCollection: AngularFirestoreCollection<EquipmentImage>;
  images$: Observable<EquipmentImageId[]>;
  images: EquipmentImageId[];
  imageOrderMax = 0;
  itemForm: FormGroup;
  id: string;
  responses: Array<any>;

  vinData: any;
  formOptions = {
    years: [],
    options: []
  };
  public uploader: FileUploader;

  constructor(private afs: AngularFirestore,
              private fb: FormBuilder,
              private router: Router,
              private activatedRoute: ActivatedRoute,
              private inventoryService: InventoryService,
              private cloudinary: Cloudinary,
              private http: HttpClient,
              private toastr: ToastrService) {

    this.responses = [];
    this.createForm();

  }

  createForm() {
    this.formOptions.years = this.range(1960, (new Date()).getFullYear(), 1).reverse();
    this.itemForm = this.fb.group({ // <-- the parent FormGroup
      name: '',
      vin: '',
      category: '',
      make: '',
      model: '',
      series: '',
      year: '',
      stockNumber: '',
      engineManufacturer: '',
      engineModel: '',
      engineHP: '',
      engineCylinders: '',
      engineLiters: '',
      fuelType: '',
      brakeType: '',
      transmission: '',
      driveType: '',
      suspension: '',
      rearEndRatio: '',
      gvwr: '',
      gvwrClass: '',
      bedDimensions: '',
      wheelBase: '',
      odometer: '',
      price: '',
      comments: '',
      status: ''
    });
  }

  ngOnInit() {
    // subscribe to router event
    this.activatedRoute.parent.params.subscribe((params: Params) => {
      this.id = params['id'];

      // get item$ and update form
      this.itemDoc = this.afs.doc<Equipment>(`inventory/${this.id}`);
      this.itemDoc.valueChanges()
        .subscribe(item => {
          this.item = item;
          this.itemForm.patchValue(item);
        });

      // get options
      this.itemOptionsCollection = this.afs.collection<EquipmentOption>(`inventory/${this.id}/options`);

      this.itemOptionsCollection.snapshotChanges()
        .take(1)
        .subscribe(options => {

          this.inventoryService.equipmentOptions.forEach(o => {
            this.formOptions.options.push({
              id: o.value,
              name: o.name,
              value: false
            });
          });

          options.map(a => {
            const data = a.payload.doc.data() as EquipmentOption;
            const id = a.payload.doc.id;
            const index = this.formOptions.options.findIndex(value => value.name === data.name);
            if (index >= 0) {
              this.formOptions.options[index].value = true;
            } else {
              this.formOptions.options.push({
                id: id,
                name: data.name,
                value: true
              });
            }
          });
        });

      // get images
      this.imageCollection = this.afs.collection<EquipmentImage>(`inventory/${this.id}/images`, ref => ref.orderBy('order', 'asc'));
      this.images$ = this.imageCollection.snapshotChanges()
        .map(actions => {
          return actions
            .map(a => {
              const data = a.payload.doc.data() as EquipmentImage;
              const id = a.payload.doc.id;
              return {id, ...data};
            });
        })
        .do(images => {
          this.images = images;

          // Save the current max order, if not set start at -1 so first will be 0
          if (images.length === 0) {
            this.imageOrderMax = -1;
          } else {
            this.imageOrderMax = images[images.length - 1].order;

            // Check if primary image needs to be updated
            if (this.item.img_public_id !== images[0].public_id) {
              this.itemDoc.update({img_public_id: images[0].public_id});
            }
          }
        });

      this.setupUploader();
    });
  }

  private setupUploader() {

    const uploaderOptions: FileUploaderOptions = {
      url: `https://api.cloudinary.com/v1_1/${this.cloudinary.config().cloud_name}/upload`,
      // Upload files automatically upon addition to upload queue
      autoUpload: true,
      // Use xhrTransport in favor of iframeTransport
      isHTML5: true,
      // Calculate progress independently for each uploaded file
      removeAfterUpload: true,
      // XHR request headers
      headers: [
        {
          name: 'X-Requested-With',
          value: 'XMLHttpRequest'
        }
      ]
    };
    this.uploader = new FileUploader(uploaderOptions);

    this.uploader.onBuildItemForm = (fileItem: any, form: FormData): any => {
      // Add Cloudinary's unsigned upload preset to the upload form
      form.append('upload_preset', this.cloudinary.config().upload_preset);
      // Add built-in and custom tags for displaying the uploaded photo in the list
      const tags = `${this.id}`;

      // Upload to a custom folder
      // Note that by default, when uploading via the API, folders are not automatically created in your Media Library.
      // In order to automatically create the folders based on the API requests,
      // please go to your account upload settings and set the 'Auto-create folders' option to enabled.
      form.append('folder', `${this.id}`);
      // Add custom tags
      form.append('tags', tags);
      // Add file to upload
      form.append('file', fileItem);

      // Use default "withCredentials" value for CORS requests
      fileItem.withCredentials = false;
      return {fileItem, form};
    };

    // Update model on completion of uploading a file
    this.uploader.onCompleteItem = (item: any, response: string, status: number, headers: ParsedResponseHeaders) => {
      const data = JSON.parse(response);

      // If first Image set the main image
      if (this.imageOrderMax === -1) {
        this.itemDoc.update({img_public_id: data.public_id});
      }

      // Add to image collection
      const imgDoc = this.afs.doc<EquipmentImage>(`inventory/${this.id}/images/${data.original_filename}`);
      imgDoc.set({
        url: data.secure_url,
        public_id: data.public_id,
        height: data.height,
        width: data.width,
        bytes: data.width,
        order: ++this.imageOrderMax // due to delay in local update, increase this locally and it will be updated again later by server
      });

    };
  }

  save() {
    this.itemDoc.update(this.itemForm.value)
      .then(value => {
        this.toastr.success(`Saved ${this.item.name}`, 'Success');
        // this.router.navigate(['../../'], {relativeTo: this.activatedRoute});
      })
      .catch(reason => {
        this.toastr.error(`${reason.toString()}`, 'Failed');
        console.error(reason);
      });
  }

  deleteImage(img: EquipmentImageId, index: number) {
    // We can't delete from cloudinary, file is left there, we will delete it from db
    this.imageCollection.doc(img.id).delete().then(() => {
      // Replace primary image if first was deleted
      if (index === 0 && this.images.length > 0) {
        this.itemDoc.update({img_public_id: this.images[0].public_id});
      } else {
        this.itemDoc.update({img_public_id: null});
      }
    });
  }

  moveImageUp(img: EquipmentImageId, target: EquipmentImageId, img_public_id: string) {
    this.imageCollection.doc(target.id).update({order: img.order});
    this.imageCollection.doc(img.id).update({order: target.order});
  }

  moveImageDown(img: EquipmentImageId, target: EquipmentImageId, img_public_id: string) {
    this.imageCollection.doc(target.id).update({order: img.order});
    this.imageCollection.doc(img.id).update({order: target.order});
  }

  range(begin, end, interval = 1) {
    const values = [];
    for (let i = begin; i < end; i += interval) {
      values.push(i);
    }
    return values;
  }

  processVin() {
    const vin = this.itemForm.value.vin;
    this.http.get(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvaluesextended/${vin}?format=json`)
      .subscribe(data => {
        // Read the result field from the JSON response.
        if (data['Results'].length > 0) {
          const vinData = data['Results'][0];
          const newData: Partial<Equipment> = {
            year: vinData.ModelYear,
            make: vinData.Make,
            model: vinData.Model,
            series: vinData.Series,
            engineManufacturer: vinData.EngineManufacturer,
            engineModel: vinData.EngineModel,
            engineCylinders: vinData.EngineCylinders,
            engineHP: vinData.EngineHP,
            engineLiters: Math.round(vinData.DisplacementL * 10) / 10,
            fuelType: vinData.FuelTypePrimary,
            gvwrClass: vinData.GVWR.replace(/\(.+\)/, '').trim(),
            driveType: vinData.DriveType,
            brakeType: vinData.BrakeSystemType
          };
          // Remove empty values
          Object.keys(newData)
            .forEach((key) => (newData[key] == null || newData[key] === '') && delete newData[key]);
          this.itemForm.patchValue(newData);

          this.vinData = vinData;
        }


      });
  }

  buildName() {
    this.itemForm.patchValue({
      name: [
        this.itemForm.value.year,
        this.itemForm.value.make,
        this.itemForm.value.model
      ]
        .join(' ')
    });
  }

  saveOption(o: any) {
    if (o.value) {
      const optionDoc = this.afs.doc<Partial<EquipmentOption>>(`inventory/${this.id}/options/${o.id}`);
      optionDoc.set({
        name: o.name
      });
    } else {
      const optionDoc = this.afs.doc<EquipmentOption>(`inventory/${this.id}/options/${o.id}`);
      optionDoc.delete();
    }
  }
}